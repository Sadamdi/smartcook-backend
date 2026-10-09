// node scripts/test-reports.js : overview, logs, trail, user search, announcement. No database.
process.env.OPS_OWNERS = "boss@example.com";

const assert = require("assert");
const http = require("http");
const path = require("path");
const express = require("express");

const stub = (rel, exports) => {
  const id = require.resolve(path.join("..", rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};

const chain = (rows) => {
  let out = rows;
  const c = {
    sort: () => c,
    limit: (n) => ((out = out.slice(0, n)), c),
    select: () => c,
    lean: async () => out.map((r) => ({ ...r })),
  };
  return c;
};

let notice = null;
let memberRows = [];
const users = [
  { _id: "507f1f77bcf86cd799439011", email: "ani@example.com", name: "Ani", auth_provider: "email", firebase_uid: "uid", onboarding_completed: true, created_at: new Date(), password: "HASH", otp_code: "1234", login_failed_attempts: 3 },
  { _id: "507f1f77bcf86cd799439012", email: "budi@example.com", name: "Budi", auth_provider: "google", created_at: new Date() },
];
stub("src/models/User", {
  estimatedDocumentCount: async () => 18,
  countDocuments: async () => 2,
  find: (f) => chain(users.filter((u) => !f.$or || f.$or.some((o) => Object.values(o).some((r) => r.test(u.email) || r.test(u.name))))),
  findById: (id) => ({ select: () => ({ lean: async () => users.find((u) => String(u._id) === String(id)) || null }) }),
});
stub("src/modules/devlog/model", {
  aggregate: async () => [{ _id: 16, errors: 40, devices: 3 }, { _id: 15, errors: 4, devices: 1 }],
  find: (q) => {
    stub.lastDevlogQuery = q;
    return chain([{ event: "render_error", level: "error", installId: "aaaa1111", createdAt: new Date() }]);
  },
});
stub("src/modules/ops/models", {
  Member: { findOne: (q) => ({ lean: async () => memberRows.find((m) => m.email === q.email && q.active === true && m.active) || null }) },
  Restriction: { countDocuments: async () => 1, find: () => ({ lean: async () => [] }) },
  Trail: { create: async () => {}, find: () => chain([{ who: "boss@example.com", action: "restriction.add", at: new Date() }]) },
  Seen: {
    countDocuments: async () => 5,
    aggregate: async () => [{ _id: 16, devices: 4 }],
    find: () => chain([{ userId: "507f1f77bcf86cd799439011", installId: "aaaa1111", deviceModel: "Redmi", ip: "203.0.113.9", lastSeen: new Date() }]),
  },
  Login: { find: () => chain([{ ip: "203.0.113.9", via: "google", at: new Date() }]) },
  Notice: {
    findOne: (q) => ({ lean: async () => (notice && !(q && q.active === true && !notice.active) ? { ...notice } : null) }),
    findOneAndUpdate: (q, upd) => {
      notice = { key: "main", ...upd.$set };
      return { lean: async () => ({ ...notice }) };
    },
  },
  SEEN_DAYS: 30,
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

const routes = require("../src/modules/ops/routes");
const N = require("../src/modules/ops/notice");

const app = express();
app.use(express.json());
app.use(require("../src/utils/i18n").middleware());
app.get("/api/app/notice", N.publicNotice);
app.use("/api/ops", routes);

const call = (port, method, url, { user, body, lang } = {}) =>
  new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { "content-type": "application/json" };
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
const normal = { _id: "n", email: "n@example.com", firebase_uid: "u" };
const logsOnly = { _id: "l", email: "logs@example.com", firebase_uid: "u" };

let pass = 0;
const t = async (name, fn) => {
  try {
    notice = null;
    memberRows = [{ email: "logs@example.com", perms: ["logs"], active: true }];
    await fn();
    pass++;
    console.log("ok  -", name);
  } catch (e) {
    console.error("FAIL -", name, "\n   ", e.stack.split("\n").filter((l) => !/node_modules|node:internal/.test(l)).slice(0, 8).join("\n    "));
    process.exitCode = 1;
  }
};

(async () => {
  const srv = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const port = srv.address().port;
  const c = (...a) => call(port, ...a);

  await t("overview: counts, errors per build and the build mix", async () => {
    const r = await c("GET", "/api/ops/overview", { user: boss });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(
      { users: r.body.data.users, newToday: r.body.data.newToday, online: r.body.data.online, devices: r.body.data.devices, restrictions: r.body.data.restrictions },
      { users: 18, newToday: 2, online: 5, devices: 5, restrictions: 1 }
    );
    assert.deepStrictEqual(r.body.data.errorsByBuild[0], { build: 16, errors: 40, devices: 3 });
    assert.deepStrictEqual(r.body.data.buildMix, [{ build: 16, devices: 4 }]);
  });

  await t("user search: never leaks secrets, finds by e-mail or name, flags Google-verified", async () => {
    const r = await c("GET", "/api/ops/users?q=ani", { user: boss });
    assert.strictEqual(r.body.data.length, 1);
    const u = r.body.data[0];
    assert.deepStrictEqual(Object.keys(u).sort(), ["createdAt", "devices", "email", "id", "name", "onboarded", "provider", "suspended", "verifiedWithGoogle"]);
    assert.strictEqual(u.devices, 1);
    assert.strictEqual(u.verifiedWithGoogle, true);
    const all = await c("GET", "/api/ops/users", { user: boss });
    assert.strictEqual(all.body.data.length, 2);
    const text = JSON.stringify(all.body);
    for (const secret of ["HASH", "1234", "password", "otp", "login_failed"]) assert.ok(!text.includes(secret), "leaked " + secret);
  });

  await t("user detail: devices and sign-ins; bad ids and unknown users are 404", async () => {
    const r = await c("GET", "/api/ops/users/507f1f77bcf86cd799439011", { user: boss });
    assert.strictEqual(r.body.data.user.email, "ani@example.com");
    assert.strictEqual(r.body.data.devices[0].deviceModel, "Redmi");
    assert.strictEqual(r.body.data.logins[0].via, "google");
    assert.ok(!JSON.stringify(r.body).includes("HASH"));
    assert.strictEqual((await c("GET", "/api/ops/users/not-an-id", { user: boss })).status, 404);
    assert.strictEqual((await c("GET", "/api/ops/users/507f1f77bcf86cd7994390ff", { user: boss })).status, 404);
  });

  await t("logs and trail: filters are passed on, bad values are ignored", async () => {
    let r = await c("GET", "/api/ops/logs?level=error&build=16&installId=aaaa1111&before=garbage&limit=5000", { user: boss });
    assert.strictEqual(r.body.data[0].event, "render_error");
    assert.deepStrictEqual(stub.lastDevlogQuery, { level: "error", appBuild: 16, installId: "aaaa1111" }, "unparseable date ignored");
    r = await c("GET", "/api/ops/logs?build=abc", { user: boss });
    assert.deepStrictEqual(stub.lastDevlogQuery, {});
    r = await c("GET", "/api/ops/trail", { user: boss });
    assert.strictEqual(r.body.data[0].action, "restriction.add");
  });

  await t("rights are separate: logs-only member reads logs, nothing else; a normal user sees only 404s", async () => {
    assert.strictEqual((await c("GET", "/api/ops/logs", { user: logsOnly })).status, 200);
    for (const u of ["/api/ops/overview", "/api/ops/users", "/api/ops/trail", "/api/ops/notice", "/api/ops/devices"]) {
      assert.strictEqual((await c("GET", u, { user: logsOnly })).status, 404, "logs-only on " + u);
    }
    for (const u of ["/api/ops/overview", "/api/ops/logs", "/api/ops/users", "/api/ops/trail", "/api/ops/notice"]) {
      assert.strictEqual((await c("GET", u, { user: normal })).status, 404, "normal user on " + u);
    }
    assert.strictEqual((await c("PUT", "/api/ops/notice", { user: normal, body: { idText: "x", active: true } })).status, 404);
  });

  await t("announcement: nothing until set; shows in the app language; expires; text is cleaned", async () => {
    assert.strictEqual((await c("GET", "/api/app/notice")).body.data, null);
    const set = await c("PUT", "/api/ops/notice", { user: boss, body: { idText: "  Perawatan   malam ini  ", enText: "Maintenance tonight", active: true } });
    assert.strictEqual(set.status, 200);
    const id = await c("GET", "/api/app/notice", { lang: "id" });
    assert.strictEqual(id.body.data.text, "Perawatan malam ini");
    const en = await c("GET", "/api/app/notice", { lang: "en" });
    assert.strictEqual(en.body.data.text, "Maintenance tonight");
    assert.ok(en.body.data.id && en.body.data.id === id.body.data.id);
    // only an English text: Indonesian users still get something readable
    await c("PUT", "/api/ops/notice", { user: boss, body: { enText: "Only English", active: true } });
    assert.strictEqual((await c("GET", "/api/app/notice", { lang: "id" })).body.data.text, "Only English");
    // switched off, empty, or past its end date: nothing
    await c("PUT", "/api/ops/notice", { user: boss, body: { idText: "x", active: false } });
    assert.strictEqual((await c("GET", "/api/app/notice")).body.data, null);
    await c("PUT", "/api/ops/notice", { user: boss, body: { active: true } });
    assert.strictEqual((await c("GET", "/api/app/notice")).body.data, null, "active without text is not shown");
    assert.strictEqual((await c("PUT", "/api/ops/notice", { user: boss, body: { idText: "x", active: true, until: "2001-01-01" } })).status, 400);
    assert.strictEqual(N.clean("a".repeat(500)).length, 280);
  });

  srv.close();
  console.log("\n" + pass + " checks passed");
  setTimeout(() => process.exit(process.exitCode || 0), 100);
})();
