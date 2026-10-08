#!/usr/bin/env node
"use strict";
// End-to-end tests of the encrypted API channel against a real Express stack
// (compression + json parser + routes + error handler). No database.
//   node scripts/test-secure-channel.js
const assert = require("assert");
const http = require("http");
const zlib = require("zlib");
const express = require("express");
const compression = require("compression");

const secure = require("../src/modules/secure/channel");

const kp = secure.generateKeyPair();
const keys = secure.loadKeys({ API_PRIVATE_KEY: kp.privateKey });
let strict = false;

// ---------------------------------------------------------------- test server
const app = express();
app.set("trust proxy", 1);
app.use(compression({ threshold: 0 }));
app.use(express.json({ limit: "1mb" }));
app.use(secure.middleware({ getKeys: () => keys, requireEncrypted: () => strict }));

// Stand-in for the access gate: needs an Authorization header except on open paths.
app.use((req, res, next) => {
  if (req.path === "/api/health" || req.path.startsWith("/api/app/") || req.path === "/api/devlog/ingest") return next();
  if (!req.headers.authorization) return res.status(401).json({ success: false, code: "NO_TOKEN" });
  return next();
});
app.get("/api/echo", (req, res) =>
  res.json({
    query: req.query,
    path: req.path,
    method: req.method,
    auth: req.headers.authorization || null,
    forwardedFor: req.headers["x-forwarded-for"] || null,
    host: req.headers.host,
    cookie: req.headers.cookie || null,
    originalUrl: req.originalUrl,
  }),
);
app.post("/api/echo", (req, res) => res.json({ body: req.body, ct: req.headers["content-type"] || null }));
app.get("/api/denied", (req, res) => res.status(403).json({ success: false, code: "FORBIDDEN_X" }));
app.get("/api/limited", (req, res) => res.status(429).set("Retry-After", "7").json({ success: false }));
app.get("/api/boom", () => {
  throw new Error("secret internal detail");
});
app.get("/api/big", (req, res) => res.json({ rows: Array.from({ length: 6000 }, (_, i) => ({ i, name: "resep-" + i })) }));
app.get("/api/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders?.();
  for (const text of ["Halo ", "dunia", "!"]) {
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
    if (typeof res.flush === "function") res.flush();
    await new Promise((r) => setTimeout(r, 5));
  }
  res.write(`data: ${JSON.stringify({ done: true, fullReply: "Halo dunia!" })}\n\n`);
  res.end();
});
app.get("/api/app/version", (req, res) => res.json({ success: true, data: { latest: 99 } }));
app.get("/api/health", (req, res) => res.json({ success: true }));
app.post("/api/devlog/ingest", (req, res) => res.json({ success: true }));
app.use((err, req, res, next) => res.status(500).json({ success: false, message: err.message }));

// ---------------------------------------------------------------- helpers
const send = (port, { method = "GET", path, headers = {}, body }) =>
  new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    const h = { ...headers };
    if (data !== null) {
      h["Content-Type"] = h["Content-Type"] || "application/json";
      h["Content-Length"] = Buffer.byteLength(data);
    }
    const r = http.request({ port, path, method, headers: h }, (res) => {
      const parts = [];
      res.on("data", (d) => parts.push(d));
      res.on("end", () => {
        let raw = Buffer.concat(parts);
        if (res.headers["content-encoding"] === "gzip") raw = zlib.gunzipSync(raw);
        resolve({ status: res.statusCode, headers: res.headers, raw: raw.toString("utf8"), wire: Buffer.concat(parts).toString("latin1") });
      });
    });
    r.on("error", reject);
    r.end(data === null ? undefined : data);
  });

const callSecure = async (port, spec, { pub = kp.publicKey, kid, t, mutate } = {}) => {
  const { envelope, ctx } = secure.clientSeal({ ...spec, ...(t !== undefined ? { t } : {}) }, pub, kid);
  const sent = mutate ? mutate(envelope) : envelope;
  const outer = await send(port, {
    method: "POST",
    path: "/api/secure",
    headers: { "Accept-Encoding": "gzip" },
    body: sent,
  });
  let inner = null;
  if (outer.status === 200 && /application\/json/.test(outer.headers["content-type"] || "")) {
    const parsed = JSON.parse(outer.raw);
    if (parsed.v === 1) inner = secure.clientOpenResponse(parsed, ctx);
  }
  return { outer, inner, ctx, envelope: sent, json: () => JSON.parse(inner.b) };
};

let passed = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------- tests
t("GET with query string round-trips; outer request is only /api/secure", async (p) => {
  const r = await callSecure(p, { method: "GET", url: "/api/echo?q=nasi+goreng&page=2", headers: { authorization: "Bearer abc" } });
  assert.strictEqual(r.outer.status, 200);
  assert.strictEqual(r.inner.s, 200);
  const j = r.json();
  assert.deepStrictEqual(j.query, { q: "nasi goreng", page: "2" });
  assert.strictEqual(j.path, "/api/echo");
  assert.strictEqual(j.originalUrl, "/api/echo?q=nasi+goreng&page=2");
  assert.strictEqual(j.method, "GET");
});

t("POST JSON body arrives parsed with its content-type", async (p) => {
  const r = await callSecure(p, { method: "POST", url: "/api/echo", headers: { authorization: "Bearer a", "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.co", n: [1, 2] }) });
  assert.deepStrictEqual(r.json().body, { email: "a@b.co", n: [1, 2] });
  assert.strictEqual(r.json().ct, "application/json");
});

t("inner Authorization reaches the access gate; missing one is a sealed 401", async (p) => {
  const ok = await callSecure(p, { method: "GET", url: "/api/echo", headers: { authorization: "Bearer tok" } });
  assert.strictEqual(ok.json().auth, "Bearer tok");
  const no = await callSecure(p, { method: "GET", url: "/api/echo" });
  assert.strictEqual(no.outer.status, 200, "outer status never reveals the result");
  assert.strictEqual(no.inner.s, 401);
});

t("inner headers cannot spoof proxy-level headers", async (p) => {
  const r = await callSecure(p, {
    method: "GET",
    url: "/api/echo",
    headers: { authorization: "Bearer a", "x-forwarded-for": "6.6.6.6", host: "evil.example", cookie: "sid=1" },
  });
  const j = r.json();
  assert.notStrictEqual(j.forwardedFor, "6.6.6.6");
  assert.ok(!/evil/.test(j.host));
  assert.strictEqual(j.cookie, null);
});

t("status codes and headers are preserved inside the envelope", async (p) => {
  const d = await callSecure(p, { method: "GET", url: "/api/denied", headers: { authorization: "x" } });
  assert.strictEqual(d.inner.s, 403);
  assert.strictEqual(d.json().code, "FORBIDDEN_X");
  const l = await callSecure(p, { method: "GET", url: "/api/limited", headers: { authorization: "x" } });
  assert.strictEqual(l.inner.s, 429);
  assert.strictEqual(l.inner.h["retry-after"], "7");
  assert.strictEqual(l.outer.status, 200);
});

t("a throwing route comes back as a sealed 500", async (p) => {
  const r = await callSecure(p, { method: "GET", url: "/api/boom", headers: { authorization: "x" } });
  assert.strictEqual(r.inner.s, 500);
  assert.ok(!/secret internal/.test(r.outer.raw), "internal message is not on the wire");
});

t("large gzip-compressed responses survive", async (p) => {
  const r = await callSecure(p, { method: "GET", url: "/api/big", headers: { authorization: "x" } });
  assert.strictEqual(r.json().rows.length, 6000);
});

t("nothing readable on the wire, in either direction", async (p) => {
  const secret = { method: "POST", url: "/api/echo", headers: { authorization: "Bearer SUPER-SECRET-TOKEN", "content-type": "application/json" }, body: JSON.stringify({ password: "hunter2-rahasia", email: "sultan@gmail.com" }) };
  const r = await callSecure(p, secret);
  const wireOut = JSON.stringify(r.envelope);
  for (const needle of ["SUPER-SECRET", "hunter2", "sultan", "gmail", "/api/echo", "password"]) {
    assert.ok(!wireOut.includes(needle), "request leaks " + needle);
    assert.ok(!r.outer.wire.includes(needle), "response leaks " + needle);
  }
  assert.strictEqual(r.json().body.password, "hunter2-rahasia");
});

t("SSE: every frame is sealed, decrypts in order, plaintext never on the wire", async (p) => {
  const { envelope, ctx } = secure.clientSeal({ method: "GET", url: "/api/stream", headers: { authorization: "x" } }, kp.publicKey);
  const outer = await send(p, { method: "POST", path: "/api/secure", body: envelope });
  assert.match(outer.headers["content-type"], /text\/event-stream/);
  const frames = outer.raw.split("\n\n").filter(Boolean).map((l) => l.replace(/^data: /, ""));
  assert.strictEqual(frames.length, 4);
  const texts = frames.map((f, i) => secure.clientOpenFrame(f, ctx, i).toString("utf8"));
  assert.ok(texts[0].includes("Halo "));
  assert.ok(texts[3].includes('"done":true') && texts[3].includes("Halo dunia!"));
  assert.ok(!outer.raw.includes("Halo") && !outer.raw.includes("fullReply"));
});

t("SSE: reordering, dropping or replaying a frame is detected", async (p) => {
  const { envelope, ctx } = secure.clientSeal({ method: "GET", url: "/api/stream", headers: { authorization: "x" } }, kp.publicKey);
  const outer = await send(p, { method: "POST", path: "/api/secure", body: envelope });
  const frames = outer.raw.split("\n\n").filter(Boolean).map((l) => l.replace(/^data: /, ""));
  assert.throws(() => secure.clientOpenFrame(frames[1], ctx, 0), "swapped position");
  assert.throws(() => secure.clientOpenFrame(frames[2], ctx, 1), "dropped frame shifts positions");
  secure.clientOpenFrame(frames[0], ctx, 0);
  assert.throws(() => secure.clientOpenFrame(frames[0], ctx, 1), "replayed frame");
  const other = secure.clientSeal({ method: "GET", url: "/api/stream", headers: {} }, kp.publicKey).ctx;
  assert.throws(() => secure.clientOpenFrame(frames[0], other, 0), "frame from another request");
});

t("a response cannot be replayed onto a different request", async (p) => {
  const a = await callSecure(p, { method: "GET", url: "/api/echo?x=1", headers: { authorization: "x" } });
  const b = secure.clientSeal({ method: "GET", url: "/api/echo?x=2", headers: { authorization: "x" } }, kp.publicKey);
  assert.throws(() => secure.clientOpenResponse(JSON.parse(a.outer.raw), b.ctx));
});

t("replaying the same sealed request is refused", async (p) => {
  const first = await callSecure(p, { method: "GET", url: "/api/echo", headers: { authorization: "x" } });
  assert.strictEqual(first.inner.s, 200);
  const again = await send(p, { method: "POST", path: "/api/secure", body: first.envelope });
  assert.strictEqual(again.status, 400);
  assert.strictEqual(JSON.parse(again.raw).code, "SECURE_BAD");
});

t("stale or future-dated requests get CLOCK_SKEW with the server time", async (p) => {
  for (const delta of [-10 * 60 * 1000, 10 * 60 * 1000]) {
    const r = await callSecure(p, { method: "GET", url: "/api/echo", headers: { authorization: "x" } }, { t: Date.now() + delta });
    assert.strictEqual(r.outer.status, 400);
    const j = JSON.parse(r.outer.raw);
    assert.strictEqual(j.code, "SECURE_CLOCK_SKEW");
    assert.ok(Math.abs(j.serverTime - Date.now()) < 5000);
  }
});

t("a request inside the clock window is accepted (skew tolerance)", async (p) => {
  const r = await callSecure(p, { method: "GET", url: "/api/echo", headers: { authorization: "x" } }, { t: Date.now() - 2 * 60 * 1000 });
  assert.strictEqual(r.inner.s, 200);
});

t("tampered ciphertext / key / nonce / kid are refused with one generic answer", async (p) => {
  const flip = (s) => (s[0] === "A" ? "B" : "A") + s.slice(1);
  for (const field of ["c", "k", "n"]) {
    const r = await callSecure(p, { method: "GET", url: "/api/echo", headers: { authorization: "x" } }, { mutate: (e) => ({ ...e, [field]: flip(e[field]) }) });
    assert.strictEqual(r.outer.status, 400, field);
    assert.deepStrictEqual(Object.keys(JSON.parse(r.outer.raw)).sort(), ["code", "message", "success"]);
  }
  const k = await callSecure(p, { method: "GET", url: "/api/echo", headers: {} }, { mutate: (e) => ({ ...e, kid: "deadbeef" }) });
  assert.strictEqual(k.outer.status, 400);
});

t("sealed to a different server key: refused", async (p) => {
  const stranger = secure.generateKeyPair();
  const r = await callSecure(p, { method: "GET", url: "/api/echo", headers: { authorization: "x" } }, { pub: stranger.publicKey, kid: kp.kid });
  assert.strictEqual(r.outer.status, 400);
});

t("nested /api/secure, non-/api paths, odd methods and CRLF urls are refused", async (p) => {
  for (const spec of [
    { method: "GET", url: "/api/secure" },
    { method: "GET", url: "/api/secure?x=1" },
    { method: "GET", url: "/admin" },
    { method: "GET", url: "/api/echo HTTP/1.1\r\nX: y" },
    { method: "GET", url: "/api/echo with space" },
    { method: "TRACE", url: "/api/echo" },
    { method: "CONNECT", url: "/api/echo" },
  ]) {
    const r = await callSecure(p, { headers: { authorization: "x" }, ...spec });
    assert.strictEqual(r.outer.status, 400, JSON.stringify(spec.url));
  }
});

t("malformed inner JSON body is refused, not crashed", async (p) => {
  const r = await callSecure(p, { method: "POST", url: "/api/echo", headers: { authorization: "x", "content-type": "application/json" }, body: "{not json" });
  assert.strictEqual(r.outer.status, 400);
});

t("20 concurrent sealed requests never mix up their answers", async (p) => {
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => callSecure(p, { method: "GET", url: `/api/echo?i=${i}`, headers: { authorization: "t" + i } })),
  );
  results.forEach((r, i) => {
    const j = r.json();
    assert.strictEqual(j.query.i, String(i));
    assert.strictEqual(j.auth, "t" + i);
  });
});

t("outer response is never cacheable and carries no inner ETag", async (p) => {
  const r = await callSecure(p, { method: "GET", url: "/api/echo", headers: { authorization: "x" } });
  assert.match(r.outer.headers["cache-control"], /no-store/);
  assert.strictEqual(r.outer.headers.etag, undefined);
});

t("compat mode: plaintext requests still work while encryption is optional", async (p) => {
  const r = await send(p, { method: "GET", path: "/api/echo?x=1", headers: { Authorization: "Bearer plain" } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(JSON.parse(r.raw).auth, "Bearer plain");
});

t("strict mode: plaintext gets 426 UPDATE_REQUIRED, exempt paths and sealed calls still work", async (p) => {
  strict = true;
  try {
    const plain = await send(p, { method: "GET", path: "/api/echo", headers: { Authorization: "Bearer plain" } });
    assert.strictEqual(plain.status, 426);
    assert.strictEqual(JSON.parse(plain.raw).code, "UPDATE_REQUIRED");
    const post = await send(p, { method: "POST", path: "/api/echo", body: { a: 1 } });
    assert.strictEqual(post.status, 426);
    assert.strictEqual((await send(p, { method: "GET", path: "/api/app/version" })).status, 200, "old apps must still see the update dialog");
    assert.strictEqual((await send(p, { method: "GET", path: "/api/health" })).status, 200);
    assert.strictEqual((await send(p, { method: "POST", path: "/api/devlog/ingest", body: {} })).status, 200);
    const sealed = await callSecure(p, { method: "GET", url: "/api/echo", headers: { authorization: "x" } });
    assert.strictEqual(sealed.inner.s, 200);
  } finally {
    strict = false;
  }
});

t("key rotation: the previous key keeps opening requests from older apps", async (p) => {
  const next = secure.generateKeyPair();
  const rotated = secure.loadKeys({ API_PRIVATE_KEY: next.privateKey, API_PRIVATE_KEY_PREV: kp.privateKey });
  assert.strictEqual(rotated.length, 2);
  const { envelope } = secure.clientSeal({ method: "GET", url: "/api/echo", headers: { authorization: "x" } }, kp.publicKey);
  assert.strictEqual(secure.openRequest(envelope, rotated).method, "GET");
  secure._resetNonces();
  const { envelope: e2 } = secure.clientSeal({ method: "GET", url: "/api/echo", headers: {} }, next.publicKey);
  assert.strictEqual(secure.openRequest(e2, rotated).method, "GET");
});

// ---------------------------------------------------------------- run
(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const [name, fn] of tests) {
      secure._resetNonces();
      await fn(port);
      passed++;
      console.log("  ok  " + name);
    }
  } finally {
    console.warn = warn;
    server.close();
  }
  console.log(`\n${passed} secure-channel tests passed`);
})().catch((e) => {
  console.error("\nFAIL:", e.stack || e.message);
  process.exit(1);
});
