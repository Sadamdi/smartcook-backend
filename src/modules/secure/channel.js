"use strict";

/**
 * End-to-end encrypted API channel between the app and this server.
 *
 * HTTPS ends at Cloudflare, so Cloudflare can read every request. This channel
 * seals each request to the server's public key inside the HTTPS body, so the
 * only thing a proxy sees is `POST /api/secure` with random-looking bytes.
 *
 *   app                                           server
 *   ---                                           ------
 *   POST /api/secure  { v, kid, k, n, c }  --->   opens it, rewrites req into the
 *                                                  real request (method, url,
 *                                                  headers, body), lets the normal
 *                                                  routes run, and seals whatever
 *                                                  they answer
 *   200 { v, n, c }                        <---   status + headers + body, sealed
 *
 * Crypto: per-request ephemeral X25519 -> HKDF-SHA256 -> AES-256-GCM. Request
 * and response use different keys (HKDF info differs) and the response AAD
 * includes the request nonce, so a response cannot be replayed onto another
 * request. SSE (chat streaming) is sealed frame by frame, each frame bound to
 * its position.
 *
 * Properties: confidentiality and integrity against anything between the app
 * and this process, replay protection (5 min window + nonce cache), forward
 * secrecy for the client side. NOT authenticity of the client: the public key
 * ships in the APK, so a modified app can still talk to the API (the existing
 * session/handshake gates apply as before).
 *
 * Rollout: plaintext requests are still served until API_REQUIRE_ENCRYPTED=1,
 * after which everything except EXEMPT paths gets 426 UPDATE_REQUIRED. The
 * exempt set must stay reachable so an old app can still see the update dialog.
 */

const crypto = require("crypto");
const devlog = require("../devlog/crypto");

const { b64u, importPrivate } = devlog;

const VERSION = 1;
const LABEL = "smartcook-api-v1";
const WINDOW_MS = 5 * 60 * 1000;
const MAX_SEALED_BYTES = 2 * 1024 * 1024;
const MAX_URL = 4096;
const NONCE_CACHE_MAX = 20000;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

// Only these inner headers are honoured. Anything else (x-forwarded-for, host,
// cookie, ...) from inside the envelope is dropped, so a sealed request cannot
// spoof what the proxy layer established.
const FORWARD_HEADERS = new Set([
  "authorization",
  "x-user-token",
  "x-smartcook-build",
  "x-smartcook-cert",
  "x-smartcook-locale",
  "accept-language",
  "content-type",
]);
// Inner response headers handed back to the app.
const RETURN_HEADERS = ["content-type", "retry-after", "ratelimit-reset", "ratelimit-remaining", "ratelimit-limit"];

class SecureError extends Error {
  constructor(code, reason) {
    super(`secure channel rejected: ${reason || code}`);
    this.code = code;
    this.reason = reason || code;
  }
}

function loadKeys(env = process.env) {
  const out = [];
  for (const name of ["API_PRIVATE_KEY", "API_PRIVATE_KEY_PREV"]) {
    const v = (env[name] || "").trim();
    if (!v) continue;
    try {
      out.push(importPrivate(v));
    } catch {
      console.error(`[secure] ${name} is not a valid X25519 PKCS8 key`);
    }
  }
  return out;
}

const hkdf = (shared, salt, info) =>
  Buffer.from(crypto.hkdfSync("sha256", shared, salt, Buffer.from(info, "utf8"), 32));

function deriveKeys(shared, ephRaw, kid) {
  return {
    reqKey: hkdf(shared, ephRaw, `${LABEL}|${kid}`),
    respKey: hkdf(shared, ephRaw, `${LABEL}|resp|${kid}`),
  };
}

function aesSeal(key, nonce, aad, plaintext) {
  const c = crypto.createCipheriv("aes-256-gcm", key, nonce);
  c.setAAD(Buffer.from(aad, "utf8"));
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

function aesOpen(key, nonce, aad, sealed) {
  const d = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
}

// Replay guard.
const seen = new Map();
function remember(nonce, now) {
  for (const [n, exp] of seen) if (exp < now) seen.delete(n);
  if (seen.size >= NONCE_CACHE_MAX) seen.delete(seen.keys().next().value);
  if (seen.has(nonce)) return false;
  seen.set(nonce, now + WINDOW_MS * 2);
  return true;
}

/** Opens a request envelope. Returns the inner request and the response context. */
function openRequest(envelope, keys, now = Date.now()) {
  if (!envelope || typeof envelope !== "object" || envelope.v !== VERSION) throw new SecureError("SECURE_BAD", "version");
  const { kid, k, n, c } = envelope;
  if ([kid, k, n, c].some((x) => typeof x !== "string")) throw new SecureError("SECURE_BAD", "shape");
  const key = keys.find((x) => x.kid === kid);
  if (!key) throw new SecureError("SECURE_BAD", "unknown_kid");

  const eph = b64u.dec(k);
  const nonce = b64u.dec(n);
  const sealed = b64u.dec(c);
  if (eph.length !== 32 || nonce.length !== 12) throw new SecureError("SECURE_BAD", "lengths");
  if (sealed.length < 17 || sealed.length > MAX_SEALED_BYTES) throw new SecureError("SECURE_BAD", "size");

  let plaintext;
  let derived;
  try {
    const peer = crypto.createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64u.enc(eph) }, format: "jwk" });
    const shared = crypto.diffieHellman({ privateKey: key.privateKey, publicKey: peer });
    derived = deriveKeys(shared, eph, kid);
    plaintext = aesOpen(derived.reqKey, nonce, `${LABEL}|${kid}|${k}`, sealed);
  } catch {
    throw new SecureError("SECURE_BAD", "decrypt");
  }

  let inner;
  try {
    inner = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new SecureError("SECURE_BAD", "json");
  }
  if (!inner || typeof inner.t !== "number") throw new SecureError("SECURE_BAD", "shape");
  // Checked after authentication, so the answer reveals nothing to a prober.
  if (Math.abs(now - inner.t) > WINDOW_MS) throw new SecureError("SECURE_CLOCK_SKEW", "stale");
  if (!remember(n, now)) throw new SecureError("SECURE_BAD", "replay");

  const method = String(inner.m || "").toUpperCase();
  const url = inner.u;
  if (!METHODS.has(method)) throw new SecureError("SECURE_BAD", "method");
  if (typeof url !== "string" || url.length > MAX_URL || !url.startsWith("/api/") || /[\u0000- \u007f]/.test(url)) {
    throw new SecureError("SECURE_BAD", "url");
  }
  if (url === "/api/secure" || url.startsWith("/api/secure?") || url.startsWith("/api/secure/")) {
    throw new SecureError("SECURE_BAD", "nested");
  }
  if (inner.h !== undefined && (typeof inner.h !== "object" || inner.h === null || Array.isArray(inner.h))) {
    throw new SecureError("SECURE_BAD", "headers");
  }
  if (inner.b !== undefined && inner.b !== null && typeof inner.b !== "string") throw new SecureError("SECURE_BAD", "body");

  return {
    method,
    url,
    headers: inner.h || {},
    body: inner.b == null ? null : inner.b,
    ctx: { respKey: derived.respKey, reqNonce: n },
  };
}

function sealResponse(ctx, status, headers, bodyText) {
  const nonce = crypto.randomBytes(12);
  const inner = Buffer.from(JSON.stringify({ s: status, h: headers, b: bodyText }), "utf8");
  const c = aesSeal(ctx.respKey, nonce, `${LABEL}|resp|${ctx.reqNonce}`, inner);
  return { v: VERSION, n: b64u.enc(nonce), c: b64u.enc(c) };
}

function sealFrame(ctx, index, buf) {
  const nonce = crypto.randomBytes(12);
  const c = aesSeal(ctx.respKey, nonce, `${LABEL}|frame|${ctx.reqNonce}|${index}`, buf);
  return b64u.enc(Buffer.concat([nonce, c]));
}

/** Rewrites the incoming request so the rest of the app sees the real one. */
function rewriteRequest(req, inner) {
  const headers = { ...req.headers };
  delete headers["content-length"];
  delete headers["transfer-encoding"];
  // The outer content-type described the envelope; the inner one (if any)
  // describes the real body.
  delete headers["content-type"];
  for (const [name, value] of Object.entries(inner.headers)) {
    const lower = String(name).toLowerCase();
    const clean = typeof value === "string" && !/[\r\n]/.test(value);
    if (FORWARD_HEADERS.has(lower) && clean) headers[lower] = value;
  }
  let body;
  if (inner.body !== null && /json/i.test(headers["content-type"] || "")) {
    body = JSON.parse(inner.body); // caller turns a failure into SECURE_BAD
  } else {
    body = {};
  }
  req.method = inner.method;
  req.url = inner.url;
  req.originalUrl = inner.url;
  req.headers = headers;
  req.body = body;
}

/** Captures what the downstream handlers write and sends it sealed instead. */
function wrapResponse(res, ctx) {
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  const origFlushHeaders = typeof res.flushHeaders === "function" ? res.flushHeaders.bind(res) : null;
  const chunks = [];
  let streaming = false;
  let index = 0;
  let finished = false;

  const toBuf = (chunk, enc) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof enc === "string" ? enc : "utf8"));
  const detectStream = () => {
    if (!streaming && /text\/event-stream/i.test(String(res.getHeader("content-type") || ""))) {
      streaming = true;
      res.removeHeader("content-length");
      res.setHeader("Cache-Control", "no-store, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
    }
    return streaming;
  };
  const frame = (buf) => `data: ${sealFrame(ctx, index++, buf)}\n\n`;

  res.flushHeaders = function flushHeaders() {
    detectStream();
    return origFlushHeaders ? origFlushHeaders() : undefined;
  };

  res.write = function write(chunk, enc, cb) {
    if (typeof enc === "function") {
      cb = enc;
      enc = undefined;
    }
    if (chunk === undefined || chunk === null || chunk === "") {
      if (cb) cb();
      return true;
    }
    if (detectStream()) return origWrite(frame(toBuf(chunk, enc)), "utf8", cb);
    chunks.push(toBuf(chunk, enc));
    if (cb) cb();
    return true;
  };

  res.end = function end(chunk, enc, cb) {
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = undefined;
      enc = undefined;
    } else if (typeof enc === "function") {
      cb = enc;
      enc = undefined;
    }
    if (finished) return res;
    finished = true;
    if (chunk !== undefined && chunk !== null && chunk !== "") {
      if (detectStream()) origWrite(frame(toBuf(chunk, enc)));
      else chunks.push(toBuf(chunk, enc));
    }
    if (detectStream()) return origEnd(cb);

    const headers = {};
    for (const name of RETURN_HEADERS) {
      const v = res.getHeader(name);
      if (v !== undefined) headers[name] = String(v);
    }
    const sealed = sealResponse(ctx, res.statusCode, headers, Buffer.concat(chunks).toString("utf8"));
    // The real status/headers now live inside the envelope.
    res.statusCode = 200;
    for (const name of ["content-length", "etag", "content-type", ...RETURN_HEADERS]) res.removeHeader(name);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return origEnd(JSON.stringify(sealed), "utf8", cb);
  };
}

/**
 * Paths a plaintext client may always use, even when encryption is required:
 * the update check/download (an old app must still be able to learn it needs
 * updating), the liveness probe, and the developer log (own envelope).
 */
function isExempt(method, pathname) {
  if (method === "OPTIONS") return true;
  if (method === "GET" && (pathname.startsWith("/api/app/") || pathname === "/api/health")) return true;
  if (method === "POST" && pathname === "/api/devlog/ingest") return true;
  return false;
}

function middleware({ getKeys, requireEncrypted } = {}) {
  let cached = null;
  const keys = getKeys || (() => (cached = cached || loadKeys()));
  const required = requireEncrypted || (() => process.env.API_REQUIRE_ENCRYPTED === "1");

  return function secureChannel(req, res, next) {
    const pathname = req.path;
    if (!(req.method === "POST" && pathname === "/api/secure")) {
      if (required() && !isExempt(req.method, pathname)) {
        return res.status(426).json({
          success: false,
          code: "UPDATE_REQUIRED",
          message: "Aplikasi perlu diperbarui ke versi terbaru agar tetap bisa dipakai.",
        });
      }
      return next();
    }

    let inner;
    try {
      inner = openRequest(req.body, keys());
      rewriteRequest(req, inner);
    } catch (e) {
      if (e instanceof SecureError) {
        // Same answer for every failure, except the one the app can act on.
        console.warn(`[secure] ${e.reason}`);
        return res.status(400).json({
          success: false,
          code: e.code,
          message: "Invalid payload.",
          ...(e.code === "SECURE_CLOCK_SKEW" ? { serverTime: Date.now() } : {}),
        });
      }
      console.warn("[secure] unreadable inner request");
      return res.status(400).json({ success: false, code: "SECURE_BAD", message: "Invalid payload." });
    }
    wrapResponse(res, inner.ctx);
    return next();
  };
}

// ---------------------------------------------------------------------------
// Reference client (tests and tooling). The app implements the same in Dart.
// ---------------------------------------------------------------------------
function clientSeal({ method, url, headers = {}, body = null, t = Date.now() }, publicKeyB64u, kid) {
  const serverPub = crypto.createPublicKey({ key: { kty: "OKP", crv: "X25519", x: publicKeyB64u }, format: "jwk" });
  const id = kid || devlog.keyId(serverPub);
  const eph = crypto.generateKeyPairSync("x25519");
  const ephRaw = devlog.rawPublic(eph.publicKey);
  const k = b64u.enc(ephRaw);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: serverPub });
  const { reqKey, respKey } = deriveKeys(shared, ephRaw, id);
  const nonce = crypto.randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify({ t, m: method, u: url, h: headers, b: body }), "utf8");
  const c = aesSeal(reqKey, nonce, `${LABEL}|${id}|${k}`, plaintext);
  const n = b64u.enc(nonce);
  return { envelope: { v: VERSION, kid: id, k, n, c: b64u.enc(c) }, ctx: { respKey, reqNonce: n } };
}

function clientOpenResponse(envelope, ctx) {
  if (!envelope || envelope.v !== VERSION) throw new SecureError("SECURE_BAD", "version");
  const plain = aesOpen(ctx.respKey, b64u.dec(envelope.n), `${LABEL}|resp|${ctx.reqNonce}`, b64u.dec(envelope.c));
  return JSON.parse(plain.toString("utf8"));
}

function clientOpenFrame(b64Frame, ctx, index) {
  const raw = b64u.dec(b64Frame);
  return aesOpen(ctx.respKey, raw.subarray(0, 12), `${LABEL}|frame|${ctx.reqNonce}|${index}`, raw.subarray(12));
}

module.exports = {
  middleware,
  isExempt,
  loadKeys,
  openRequest,
  SecureError,
  generateKeyPair: devlog.generateKeyPair,
  clientSeal,
  clientOpenResponse,
  clientOpenFrame,
  WINDOW_MS,
  _resetNonces: () => seen.clear(),
};
