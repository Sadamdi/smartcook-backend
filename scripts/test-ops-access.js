// node scripts/test-ops-access.js : who may reach the /api/ops area. No database, no network.
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
let members = [];
let trail = [];
const pick = (rows, q) => rows.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v));
const Member = {
  find: () => ({ sort: () => ({ lean: async () => members.map((m) => ({ createdAt: new Date(), ...m })) }) }),
  findOne: (q) => {
    const row = pick(members, q)[0] || null;
    const wrapped = row && Object.assign(row, { save: async () => row });
    const p = Promise.resolve(wrapped);
    p.lean = async () => (row ? { ...row } : null);
    return p;
  },
  findOneAndUpdate: (q, upd) => {
    let row = pick(members, q)[0];
    if (!row) {
      row = { ...q, ...(upd.$setOnInsert || {}) };
      members.push(row);
    }
    Object.assign(row, upd.$set || {});
    return { lean: async () => ({ ...row }) };
  },
  deleteOne: async (q) => {
    members = members.filter((m) => m.email !== q.email);
  },
};
stub("src/modules/ops/models", { Member, Restriction: {}, Trail: { create: async (d) => trail.push(d) }, TRAIL_DAYS: 180, DAY: 86400000 });
stub("src/middleware/auth", {
  protect: (req, res, next) => {
    const raw = req.headers["x-test-user"];
    if (!raw) return res.status(401).json({ success: false });
    req.user = JSON.parse(raw);
    next();
  },
});

const routes = require("../src/modules/ops/routes");

const app = express();
app.use(express.json());
app.use("/api/ops", routes);
app.use((req, res) => res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." }));

const call = (port, method, url, user, body) =>
  new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { "content-type": "application/json" };
    if (user) headers["x-test-user"] = JSON.stringify(user);
    if (data) headers["content-length"] = Buffer.byteLength(data);
    const rq = http.request({ port, method, path: url, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    rq.on("error", reject);
    rq.end(data || undefined);
  });

const verified = (email) => ({ _id: email, email, firebase_uid: "uid-" + email });
const boss = verified("boss@example.com");

let pass = 0;
const t = async (name, fn) => {
  try {
    members = [];
    trail = [];
    await fn();
    pass++;
    console.log("ok  -", name);
  } catch (e) {
    console.error("FAIL -", name, "\n   ", e.message);
    process.exitCode = 1;
  }
};

(async () => {
  const srv = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const port = srv.address().port;
  const c = (...a) => call(port, ...a);

  await t("/me says nothing to a normal user and never errors", async () => {
    const r = await c("GET", "/api/ops/me", verified("someone@example.com"));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.data, null);
  });

  await t("every other route looks exactly like an unknown route to a normal user", async () => {
    const unknown = await c("GET", "/api/nothing-here", verified("someone@example.com"));
    for (const [m, u] of [["GET", "/api/ops/members"], ["POST", "/api/ops/members"], ["PATCH", "/api/ops/members/a@b.co"], ["DELETE", "/api/ops/members/a@b.co"], ["GET", "/api/ops/anything"]]) {
      const r = await c(m, u, verified("someone@example.com"), { email: "a@b.co" });
      assert.strictEqual(r.status, 404, m + " " + u);
      assert.deepStrictEqual(r.body, unknown.body, m + " " + u + " must match the unknown-route answer");
    }
  });

  await t("no session at all -> 401 (the access gate), never a hint", async () => {
    assert.strictEqual((await c("GET", "/api/ops/members")).status, 401);
  });

  await t("the owner from the environment has every right", async () => {
    const r = await c("GET", "/api/ops/me", boss);
    assert.strictEqual(r.body.data.role, "owner");
    assert.ok(r.body.data.perms.includes("members") && r.body.data.perms.includes("restrict"));
    assert.strictEqual((await c("GET", "/api/ops/members", boss)).status, 200);
  });

  await t("an unverified address gets nothing, even when it is listed (registered by e-mail only)", async () => {
    members.push({ email: "new@example.com", perms: ["members"], active: true });
    const unverified = { _id: "x", email: "new@example.com" }; // no firebase uid
    assert.strictEqual((await c("GET", "/api/ops/me", unverified)).body.data, null);
    assert.strictEqual((await c("GET", "/api/ops/members", unverified)).status, 404);
    const ownerImpostor = { _id: "y", email: "boss@example.com" };
    assert.strictEqual((await c("GET", "/api/ops/me", ownerImpostor)).body.data, null, "owner address without proof");
    assert.strictEqual((await c("GET", "/api/ops/members", ownerImpostor)).status, 404);
  });

  await t("a member only reaches what its rights say; inactive members reach nothing", async () => {
    members.push({ email: "m@example.com", perms: ["logs"], active: true });
    const m = verified("m@example.com");
    assert.deepStrictEqual((await c("GET", "/api/ops/me", m)).body.data.perms, ["logs"]);
    assert.strictEqual((await c("GET", "/api/ops/members", m)).status, 404, "no members right");
    members[0].active = false;
    assert.strictEqual((await c("GET", "/api/ops/me", m)).body.data, null);
  });

  await t("the owner adds, edits and removes members; each action is written to the trail", async () => {
    let r = await c("POST", "/api/ops/members", boss, { email: "A@Example.com", perms: ["logs", "devices", "bogus"] });
    assert.strictEqual(r.status, 201);
    assert.deepStrictEqual(r.body.data.perms, ["logs", "devices"], "unknown rights are dropped, e-mail lower-cased");
    r = await c("PATCH", "/api/ops/members/a@example.com", boss, { perms: ["logs"], active: true });
    assert.deepStrictEqual(r.body.data.perms, ["logs"]);
    r = await c("DELETE", "/api/ops/members/a@example.com", boss);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(members.length, 0);
    assert.deepStrictEqual(trail.map((x) => x.action), ["member.add", "member.update", "member.remove"]);
    assert.ok(trail.every((x) => x.who === "boss@example.com" && x.expiresAt > new Date()));
  });

  await t("owners cannot be changed, nobody edits themselves, bad e-mails are refused", async () => {
    members.push({ email: "adm@example.com", perms: ["members", "logs"], active: true });
    const adm = verified("adm@example.com");
    assert.strictEqual((await c("POST", "/api/ops/members", adm, { email: "boss@example.com", perms: [] })).status, 400);
    assert.strictEqual((await c("PATCH", "/api/ops/members/boss@example.com", adm, { perms: [] })).status, 400);
    assert.strictEqual((await c("DELETE", "/api/ops/members/boss@example.com", adm)).status, 400);
    assert.strictEqual((await c("PATCH", "/api/ops/members/adm@example.com", adm, { perms: ["logs", "devices"] })).status, 400, "own row");
    assert.strictEqual((await c("POST", "/api/ops/members", boss, { email: "not-an-email", perms: [] })).status, 400);
  });

  await t("a member cannot hand out more than it holds, nor the right to manage members", async () => {
    members.push({ email: "adm@example.com", perms: ["members", "logs"], active: true });
    const adm = verified("adm@example.com");
    assert.strictEqual((await c("POST", "/api/ops/members", adm, { email: "x@example.com", perms: ["devices"] })).status, 400, "does not hold devices");
    assert.strictEqual((await c("POST", "/api/ops/members", adm, { email: "x@example.com", perms: ["members"] })).status, 400, "only an owner grants members");
    assert.strictEqual((await c("POST", "/api/ops/members", adm, { email: "x@example.com", perms: ["logs"] })).status, 201);
    // another manager is out of reach for a non-owner
    members.push({ email: "other@example.com", perms: ["members"], active: true });
    assert.strictEqual((await c("DELETE", "/api/ops/members/other@example.com", adm)).status, 400);
    assert.strictEqual((await c("PATCH", "/api/ops/members/other@example.com", adm, { perms: [] })).status, 400);
  });

  srv.close();
  console.log(`\n${pass} checks passed`);
})();
