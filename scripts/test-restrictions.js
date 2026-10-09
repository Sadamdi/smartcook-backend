// node scripts/test-restrictions.js : address / e-mail restrictions. No database, no network.
process.env.OPS_OWNERS = "boss@example.com";

const assert = require("assert");
const http = require("http");
const path = require("path");
const express = require("express");

const stub = (rel, exports) => {
  const id = require.resolve(path.join("..", rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};

// ------------------------------------------------------------ in-memory models
let rows = [];
let trail = [];
let seq = 0;
const match = (r, q) =>
  Object.entries(q || {}).every(([k, v]) => {
    if (k === "$or") return v.some((alt) => match(r, alt));
    if (v && v.$gt) return r[k] && new Date(r[k]) > v.$gt;
    if (v instanceof RegExp) return v.test(String(r[k] || ""));
    return r[k] === v;
  });
const Restriction = {
  countDocuments: async (q) => rows.filter((r) => match(r, q)).length,
  find: (q) => {
    let out = rows.filter((r) => match(r, q));
    const chain = { sort: () => chain, skip: (n) => ((out = out.slice(n)), chain), limit: (n) => ((out = out.slice(0, n)), chain), lean: async () => out.map((r) => ({ ...r })) };
    return chain;
  },
  findOneAndUpdate: (q, upd, opts) => {
    let row = rows.find((r) => Object.entries(q).every(([k, v]) => String(r[k]) === String(v)));
    if (!row && opts && opts.upsert) {
      row = { _id: String(++seq).padStart(24, "0"), createdAt: new Date(), ...(upd.$setOnInsert || {}) };
      rows.push(row);
    }
    if (row) Object.assign(row, upd.$set || {});
    return { lean: async () => (row ? { ...row } : null), then: (res, rej) => Promise.resolve(row).then(res, rej) };
  },
};
stub("src/modules/ops/models", {
  Member: { findOne: () => ({ lean: async () => null }) },
  Restriction,
  Trail: { create: async (d) => trail.push(d) },
  TRAIL_DAYS: 180,
  DAY: 86400000,
});
stub("src/middleware/auth", {
  protect: (req, res, next) => {
    const raw = req.headers["x-test-user"];
    if (!raw) return res.status(401).json({ success: false });
    req.user = JSON.parse(raw);
    next();
  },
});

const R = require("../src/modules/ops/restrictions");
const routes = require("../src/modules/ops/routes");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(require("../src/utils/i18n").middleware());
app.use(R.ipGate());
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/app/version", (req, res) => res.json({ ok: true }));
app.get("/api/recipes", (req, res) => res.json({ ok: true }));
app.use("/api/ops", routes);

const call = (port, method, url, { user, body, ip, lang } = {}) =>
  new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { "content-type": "application/json", "x-forwarded-for": ip || "198.51.100.7" };
    if (user) headers["x-test-user"] = JSON.stringify(user);
    if (lang) headers["x-smartcook-locale"] = lang;
    if (data) headers["content-length"] = Buffer.byteLength(data);
    const rq = http.request({ port, method, path: url, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    rq.on("error", reject);
    rq.end(data || undefined);
  });

const boss = { _id: "b", email: "boss@example.com", firebase_uid: "u" };

let pass = 0;
const t = async (name, fn) => {
  try {
    rows = [];
    trail = [];
    R._setRules([]);
    await fn();
    pass++;
    console.log("ok  -", name);
  } catch (e) {
    console.error("FAIL -", name, "\n   ", e.stack.split("\n").slice(0, 3).join("\n    "));
    process.exitCode = 1;
  }
};

(async () => {
  const srv = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const port = srv.address().port;
  const c = (...a) => call(port, ...a);

  await t("address parsing: single, mapped IPv6, subnet (/16../32); junk and huge ranges refused", () => {
    assert.ok(R.parseIpTarget("1.2.3.4"));
    assert.ok(R.parseIpTarget("::ffff:1.2.3.4"));
    assert.ok(R.parseIpTarget("2001:db8::1"));
    assert.ok(R.parseIpTarget("10.1.2.0/24"));
    for (const bad of ["", "abc", "1.2.3", "1.2.3.4/8", "1.2.3.4/33", "1.2.3.4/x", "999.1.1.1"]) assert.strictEqual(R.parseIpTarget(bad), null, bad);
    assert.strictEqual(R.normalizeIp("::FFFF:1.2.3.4"), "1.2.3.4");
  });

  await t("matching: exact, subnet, mapped form, other family never matches", () => {
    R._setRules([
      { kind: "ip", value: "203.0.113.5", reason: "a" },
      { kind: "ip", value: "198.51.100.0/24", reason: "b" },
      { kind: "ip", value: "2001:db8::1", reason: "c" },
    ]);
    assert.strictEqual(R.ipRestricted("203.0.113.5").reason, "a");
    assert.strictEqual(R.ipRestricted("::ffff:203.0.113.5").reason, "a");
    assert.strictEqual(R.ipRestricted("198.51.100.77").reason, "b");
    assert.strictEqual(R.ipRestricted("198.51.101.1"), null);
    assert.strictEqual(R.ipRestricted("203.0.113.6"), null);
    assert.strictEqual(R.ipRestricted("2001:db8::1").reason, "c");
    assert.strictEqual(R.ipRestricted("2001:db8::2"), null);
    assert.strictEqual(R.ipRestricted(""), null);
    assert.strictEqual(R.ipRestricted("garbage"), null);
  });

  await t("a rule with an end date stops applying when it passes; e-mail match ignores case", () => {
    R._setRules([
      { kind: "ip", value: "203.0.113.5", reason: "x", until: new Date(Date.now() - 1000) },
      { kind: "email", value: "bad@example.com", reason: "spam", until: new Date(Date.now() + 60000) },
    ]);
    assert.strictEqual(R.ipRestricted("203.0.113.5"), null);
    assert.strictEqual(R.emailRestricted("BAD@Example.com").reason, "spam");
    assert.strictEqual(R.emailRestricted("good@example.com"), null);
  });

  await t("a restricted address gets 403 IP_BLOCKED in the app language; health and update downloads stay open", async () => {
    R._setRules([{ kind: "ip", value: "203.0.113.5", reason: "abuse" }]);
    const id = await c("GET", "/api/recipes", { ip: "203.0.113.5" });
    assert.strictEqual(id.status, 403);
    assert.strictEqual(id.body.code, "IP_BLOCKED");
    assert.strictEqual(id.body.message, "Anda telah diblokir dari layanan ini.");
    assert.strictEqual(id.body.reason, "abuse");
    const en = await c("GET", "/api/recipes", { ip: "203.0.113.5", lang: "en" });
    assert.strictEqual(en.body.message, "You have been blocked from this service.");
    assert.strictEqual((await c("GET", "/api/health", { ip: "203.0.113.5" })).status, 200);
    assert.strictEqual((await c("GET", "/api/app/version", { ip: "203.0.113.5" })).status, 200);
    assert.strictEqual((await c("GET", "/api/recipes", { ip: "203.0.113.9" })).status, 200, "neighbour unaffected");
  });

  await t("the client cannot dodge it by sending its own forwarding header chain", async () => {
    R._setRules([{ kind: "ip", value: "203.0.113.5", reason: "" }]);
    // trust proxy = 1: the LAST hop (added by the tunnel) decides, not what the client prepends
    const r = await c("GET", "/api/recipes", { ip: "198.51.100.1, 203.0.113.5" });
    assert.strictEqual(r.status, 403);
  });

  await t("suspended(): refuses a suspended e-mail with its reason, lets others through", async () => {
    R._setRules([{ kind: "email", value: "bad@example.com", reason: "fraud" }]);
    const out = { status: 0, body: null };
    const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
    assert.strictEqual(await R.suspended(res, "Bad@example.com"), true);
    assert.strictEqual(out.status, 403);
    assert.strictEqual(out.body.code, "ACCOUNT_SUSPENDED");
    assert.strictEqual(out.body.reason, "fraud");
    assert.strictEqual(await R.suspended({ status() { throw new Error("must not answer"); } }, "ok@example.com"), false);
  });

  await t("the refusal says how long is left (null when it has no end), so the phone can count down", async () => {
    const until = new Date(Date.now() + 90 * 60 * 1000);
    R._setRules([{ kind: "ip", value: "203.0.113.5", reason: "abuse", until }, { kind: "email", value: "bad@example.com", reason: "", until: null }]);
    const timed = await c("GET", "/api/recipes", { ip: "203.0.113.5" });
    assert.ok(timed.body.remainingSeconds > 5390 && timed.body.remainingSeconds <= 5400, String(timed.body.remainingSeconds));
    assert.strictEqual(new Date(timed.body.until).getTime(), until.getTime());
    const res = { status: () => res, json: (b) => (res.body = b) };
    await R.suspended(res, "bad@example.com");
    assert.strictEqual(res.body.code, "ACCOUNT_SUSPENDED");
    assert.strictEqual(res.body.remainingSeconds, null);
    assert.strictEqual(res.body.until, null);
  });

  await t("describe(): the rule that applies, with its id and time left, for any address or e-mail it covers", () => {
    R._setRules([
      { id: "ip1", kind: "ip", value: "203.0.113.0/24", reason: "abuse", until: new Date(Date.now() + 600e3) },
      { id: "em1", kind: "email", value: "bad@example.com", reason: "", until: null },
    ]);
    const ip = R.describe(R.ipRestricted("203.0.113.77"));
    assert.strictEqual(ip.id, "ip1");
    assert.ok(ip.remainingSeconds > 590 && ip.remainingSeconds <= 600);
    const em = R.describe(R.emailRestricted("BAD@example.com"));
    assert.deepStrictEqual(em, { id: "em1", reason: "", remainingSeconds: null });
    assert.strictEqual(R.describe(R.ipRestricted("198.51.100.1")), null);
    R._setRules([]);
  });

  await t("owner list: only live rules, paged 10 at a time, filter by kind, shows time left", async () => {
    R._setRules([]);
    rows = [];
    const now = Date.now();
    for (let i = 0; i < 12; i++) rows.push({ _id: String(i + 1).padStart(24, "0"), kind: i % 4 === 0 ? "ip" : "email", value: i % 4 === 0 ? "203.0.113." + i : "u" + i + "@example.com", reason: "r", by: "boss@example.com", active: true, until: i === 1 ? new Date(now - 1000) : i === 2 ? new Date(now + 3600e3) : null, createdAt: new Date(now - i * 1000) });
    const plain = await c("GET", "/api/ops/restrictions", { user: boss });
    assert.ok(Array.isArray(plain.body.data));
    assert.strictEqual(plain.body.data.length, 11, "the one that ran out is not listed");
    const p1 = await c("GET", "/api/ops/restrictions?page=1&pageSize=10", { user: boss });
    assert.strictEqual(p1.body.data.total, 11);
    assert.strictEqual(p1.body.data.pages, 2);
    assert.strictEqual(p1.body.data.items.length, 10);
    const p2 = await c("GET", "/api/ops/restrictions?page=2&pageSize=10", { user: boss });
    assert.strictEqual(p2.body.data.items.length, 1);
    const ips = await c("GET", "/api/ops/restrictions?page=1&kind=ip", { user: boss });
    assert.ok(ips.body.data.items.every((x) => x.kind === "ip"));
    const timed = p1.body.data.items.find((x) => x.until);
    assert.ok(timed.remainingSeconds > 3500 && timed.remainingSeconds <= 3600);
    assert.ok(p1.body.data.items.some((x) => x.remainingSeconds === null));
    rows = [];
  });

  await t("owner creates and lifts restrictions through the API; changes apply at once", async () => {
    let r = await c("POST", "/api/ops/restrictions", { user: boss, body: { ip: "203.0.113.0/24", email: "bad@example.com", reason: "abuse" } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.data.length, 2);
    assert.strictEqual((await c("GET", "/api/recipes", { ip: "203.0.113.50" })).status, 403);
    r = await c("GET", "/api/ops/restrictions", { user: boss });
    assert.strictEqual(r.body.data.length, 2);
    const ipRule = r.body.data.find((x) => x.kind === "ip");
    r = await c("DELETE", "/api/ops/restrictions/" + ipRule.id, { user: boss });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await c("GET", "/api/recipes", { ip: "203.0.113.50" })).status, 200);
    assert.deepStrictEqual(trail.map((x) => x.action), ["restriction.add", "restriction.add", "restriction.lift"]);
  });

  await t("safety rules: not the owner, not yourself, not this machine, nothing malformed", async () => {
    for (const body of [
      { email: "boss@example.com" },
      { ip: "198.51.100.7" }, // the caller's own address
      { ip: "198.51.100.0/24" }, // a range that contains it
      { ip: "127.0.0.1" },
      { ip: "::1" },
      { ip: "not-an-ip" },
      { email: "nope" },
      {},
      { ip: "203.0.113.5", until: "yesterday" },
    ]) {
      const r = await c("POST", "/api/ops/restrictions", { user: boss, body });
      assert.strictEqual(r.status, 400, JSON.stringify(body));
    }
    assert.strictEqual(rows.length, 0);
  });

  await t("restricting the same target twice updates the one rule", async () => {
    await c("POST", "/api/ops/restrictions", { user: boss, body: { ip: "203.0.113.5", reason: "one" } });
    await c("POST", "/api/ops/restrictions", { user: boss, body: { ip: "203.0.113.5", reason: "two" } });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].reason, "two");
  });

  await t("a normal user sees nothing of these routes (same 404 as any unknown route)", async () => {
    const user = { _id: "n", email: "n@example.com", firebase_uid: "u" };
    for (const [m, u] of [["GET", "/api/ops/restrictions"], ["POST", "/api/ops/restrictions"], ["DELETE", "/api/ops/restrictions/abc"]]) {
      assert.strictEqual((await c(m, u, { user, body: { ip: "203.0.113.5" } })).status, 404, m + " " + u);
    }
  });

  srv.close();
  console.log(`\n${pass} checks passed`);
})();
