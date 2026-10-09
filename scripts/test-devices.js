// node scripts/test-devices.js : install registry + phone readings. No database.
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
let seenRows = [];
let loginRows = [];
const matchFilter = (r, f) =>
  Object.entries(f).every(([k, v]) => {
    if (k === "$or") return v.some((alt) => matchFilter(r, alt));
    if (v && v.$gt) return new Date(r[k]) > v.$gt;
    if (v && v.$lt) return new Date(r[k]) < v.$lt;
    if (v && v.$in) return v.$in.includes(r[k]);
    if (v instanceof RegExp) return v.test(String(r[k] || ""));
    return r[k] === v;
  });
const chain = (rows) => {
  let out = rows;
  const c = {
    sort: (s) => {
      const [k, dir] = Object.entries(s)[0];
      out = [...out].sort((a, b) => (new Date(a[k]) - new Date(b[k])) * dir);
      return c;
    },
    skip: (n) => ((out = out.slice(n)), c),
    limit: (n) => ((out = out.slice(0, n)), c),
    select: () => c,
    lean: async () => out.map((r) => ({ ...r })),
  };
  return c;
};
const Seen = {
  find: (f) => chain(seenRows.filter((r) => matchFilter(r, f || {}))),
  countDocuments: async (f) => seenRows.filter((r) => matchFilter(r, f || {})).length,
  findOne: (f) => ({ lean: async () => (seenRows.find((r) => matchFilter(r, f)) ? { ...seenRows.find((r) => matchFilter(r, f)) } : null) }),
  updateOne: async (f, upd) => {
    let row = seenRows.find((r) => r.installId === f.installId);
    if (!row) {
      row = { installId: f.installId, batches: 0, ...(upd.$setOnInsert || {}) };
      seenRows.push(row);
    }
    Object.assign(row, upd.$set || {});
    row.batches += (upd.$inc && upd.$inc.batches) || 0;
  },
};
const Login = {
  create: async (d) => loginRows.push({ ...d }),
  find: (f) => chain(loginRows.filter((r) => matchFilter(r, f || {}))),
};
stub("src/modules/ops/models", {
  Member: { findOne: () => ({ lean: async () => null }) },
  Restriction: { find: () => ({ lean: async () => [] }) },
  Trail: { create: async () => {} },
  Seen,
  Login,
  SEEN_DAYS: 30,
  TRAIL_DAYS: 180,
  DAY: 86400000,
});
const users = [{ _id: "507f1f77bcf86cd799439011", email: "ani@example.com", name: "Ani" }];
stub("src/models/User", {
  find: (f) => ({
    select: () => ({
      limit: () => ({ lean: async () => users.filter((u) => (f.$or ? f.$or.some((o) => Object.values(o).some((rx) => rx.test(u.email) || rx.test(u.name))) : f._id.$in.includes(String(u._id))) ) }),
      lean: async () => users.filter((u) => f._id && f._id.$in.includes(String(u._id))),
    }),
  }),
});
stub("src/modules/devlog/model", { find: () => chain([{ event: "app_launch", createdAt: new Date() }]) });
stub("src/middleware/auth", {
  protect: (req, res, next) => {
    const raw = req.headers["x-test-user"];
    if (!raw) return res.status(401).json({ success: false });
    req.user = JSON.parse(raw);
    next();
  },
});

const live = require("../src/modules/ops/live");
const seen = require("../src/modules/ops/seen");
const routes = require("../src/modules/ops/routes");
const telemetry = require("../src/modules/ops/telemetry");

let pass = 0;
const t = async (name, fn) => {
  try {
    seenRows = [];
    loginRows = [];
    live._reset();
    await fn();
    pass++;
    console.log("ok  -", name);
  } catch (e) {
    console.error("FAIL -", name, "\n   ", e.stack.split("\n").slice(0, 3).join("\n    "));
    process.exitCode = 1;
  }
};

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use("/api/ops", routes);
app.use("/api/telemetry", telemetry);

const call = (port, method, url, { user, body } = {}) =>
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

const boss = { _id: "b", email: "boss@example.com", firebase_uid: "u" };
const ID = "install-abc-12345";

(async () => {
  const srv = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const port = srv.address().port;
  const c = (...a) => call(port, ...a);

  await t("readings: only whitelisted numbers survive, clamped; junk ids are refused", () => {
    const r = live.beat({ installId: ID, cpu: 250, rssMb: -5, battery: "88", charging: "yes", tempC: 36.5, thermal: 2, secret: "x", net: 1 });
    assert.deepStrictEqual(r, { ok: true, next: 60, watch: false });
    const got = live.read(ID);
    assert.strictEqual(got.cpu, 100, "clamped");
    assert.strictEqual(got.rssMb, 0);
    assert.strictEqual(got.battery, 88);
    assert.strictEqual(got.charging, null, "a non-boolean is dropped, not coerced");
    assert.strictEqual(got.secret, undefined);
    for (const bad of [undefined, null, {}, { installId: "x" }, { installId: "a/b/../c" }, { installId: 5 }]) assert.strictEqual(live.beat(bad).ok, false);
  });

  await t("adaptive pace: 60 s normally, 2 s while watched, back to 60 s when the watch lapses", () => {
    const t0 = 5000000;
    assert.strictEqual(live.beat({ installId: ID }, t0).next, 60);
    live.want(ID, t0 + 100);
    const fast = live.beat({ installId: ID }, t0 + 2000);
    assert.deepStrictEqual([fast.next, fast.watch], [2, true]);
    live.want(ID, t0 + 20000); // renewed
    assert.strictEqual(live.beat({ installId: ID }, t0 + 40000).next, 2, "still inside the renewed window");
    const slow = live.beat({ installId: ID }, t0 + 60000);
    assert.deepStrictEqual([slow.next, slow.watch], [60, false]);
  });

  await t("a phone cannot flood: a second beat inside 800 ms is ignored", () => {
    const t0 = 7000000;
    live.beat({ installId: ID, cpu: 10 }, t0);
    const r = live.beat({ installId: ID, cpu: 99 }, t0 + 200);
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(live.read(ID, t0 + 200).cpu, 10);
  });

  await t("stale and connected lists follow the clock", () => {
    const t0 = 9000000;
    live.beat({ installId: ID, cpu: 5 }, t0);
    assert.strictEqual(live.connected(t0 + 1000).length, 1);
    assert.strictEqual(live.read(ID, t0 + live.LIVE_MS + 1).stale, true);
    assert.strictEqual(live.connected(t0 + live.LIVE_MS + 1).length, 0);
  });

  await t("registry: one row per install, newest facts win, full address kept, throttled to 1 write / 30 s", async () => {
    const docs = [
      { installId: ID, event: "app_launch", userId: "507f1f77bcf86cd799439011", deviceModel: "M2006C3MG", deviceManufacturer: "Xiaomi", osVersion: "10", appBuild: 16, country: "ID", timezone: "Asia/Jakarta" },
      { installId: ID, event: "app_resume", appBuild: 16 },
    ];
    await seen.touch(docs, "203.0.113.9");
    await seen.touch(docs, "203.0.113.10"); // inside the throttle window: ignored
    assert.strictEqual(seenRows.length, 1);
    assert.strictEqual(seenRows[0].ip, "203.0.113.9");
    assert.strictEqual(seenRows[0].deviceModel, "M2006C3MG", "a later sparse event does not blank the model");
    assert.strictEqual(seenRows[0].lastEvent, "app_resume");
    assert.ok(seenRows[0].expiresAt > new Date());
    await seen.touch([], "1.1.1.1");
    await seen.touch(null, "1.1.1.1");
    await seen.touch([{ event: "x" }], "1.1.1.1"); // no install id
    assert.strictEqual(seenRows.length, 1);
  });

  await t("sign-ins are recorded with the real address and expire", async () => {
    await seen.recordLogin({ ip: "203.0.113.9", headers: { "user-agent": "ua" } }, { _id: "u1" }, "google");
    assert.strictEqual(loginRows.length, 1);
    assert.strictEqual(loginRows[0].ip, "203.0.113.9");
    assert.strictEqual(loginRows[0].via, "google");
    await seen.recordLogin({ ip: "x", headers: {} }, null, "x"); // nothing to record, no throw
    assert.strictEqual(loginRows.length, 1);
  });

  await t("list and detail: online filter, search by user, device facts, logins and events", async () => {
    const now = Date.now();
    seenRows.push(
      { installId: "aaaa1111", userId: "507f1f77bcf86cd799439011", deviceModel: "Redmi", manufacturer: "Xiaomi", ip: "203.0.113.9", lastSeen: new Date(now - 5000), firstSeen: new Date(now - 9e6), batches: 3 },
      { installId: "bbbb2222", userId: null, deviceModel: "Pixel", manufacturer: "Google", ip: "198.51.100.4", lastSeen: new Date(now - 3600e3), firstSeen: new Date(now - 9e6), batches: 1 }
    );
    loginRows.push({ userId: "507f1f77bcf86cd799439011", ip: "203.0.113.9", via: "google", at: new Date() });
    const all = await seen.list({});
    assert.deepStrictEqual(all.map((d) => d.installId), ["aaaa1111", "bbbb2222"], "newest first");
    assert.strictEqual(all[0].online, true);
    assert.strictEqual(all[1].online, false);
    assert.deepStrictEqual(all[0].user, { email: "ani@example.com", name: "Ani" });
    assert.deepStrictEqual((await seen.list({ online: true })).map((d) => d.installId), ["aaaa1111"]);
    assert.deepStrictEqual((await seen.list({ q: "ani" })).map((d) => d.installId), ["aaaa1111"], "search by the user's e-mail");
    assert.deepStrictEqual((await seen.list({ q: "pixel" })).map((d) => d.installId), ["bbbb2222"]);
    const d = await seen.detail("aaaa1111");
    assert.strictEqual(d.device.deviceModel, "Redmi");
    assert.strictEqual(d.logins.length, 1);
    assert.strictEqual(d.events[0].event, "app_launch");
    assert.strictEqual(await seen.detail("nope"), null);
  });

  await t("routes: the right to see devices is separate from the right to watch live", async () => {
    seenRows.push({ installId: ID, deviceModel: "Redmi", lastSeen: new Date(), firstSeen: new Date(), batches: 1 });
    live.beat({ installId: ID, cpu: 12 });
    let r = await c("GET", "/api/ops/devices", { user: boss });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.data[0].live.cpu, 12, "owner sees the reading");
    r = await c("GET", "/api/ops/devices/" + ID, { user: boss });
    assert.strictEqual(r.body.data.device.installId, ID);
    assert.strictEqual((await c("GET", "/api/ops/devices/unknown-install", { user: boss })).status, 404);
    // a normal user: the same 404 as anything else
    const normal = { _id: "n", email: "n@example.com", firebase_uid: "u" };
    assert.strictEqual((await c("GET", "/api/ops/devices", { user: normal })).status, 404);
    assert.strictEqual((await c("GET", "/api/ops/stream/device/" + ID, { user: normal })).status, 404);
  });

  await t("watching a phone makes its next answer 'report every 2 s'", async () => {
    const first = await c("POST", "/api/telemetry/beat", { body: { installId: ID, cpu: 1 } });
    assert.deepStrictEqual(first.body.data, { next: 60, watch: false });
    // open the live view (SSE) and read until the first frame
    await new Promise((resolve, reject) => {
      const rq = http.request({ port, method: "GET", path: "/api/ops/stream/device/" + ID, headers: { "x-test-user": JSON.stringify(boss) } }, (res) => {
        assert.match(res.headers["content-type"], /event-stream/);
        res.once("data", async (chunk) => {
          try {
            assert.match(String(chunk), /"type":"(waiting|reading)"/);
            await new Promise((x) => setTimeout(x, 900)); // let the beat gap pass
            const next = await c("POST", "/api/telemetry/beat", { body: { installId: ID, cpu: 2 } });
            assert.deepStrictEqual(next.body.data, { next: 2, watch: true });
            rq.destroy();
            resolve();
          } catch (e) {
            rq.destroy();
            reject(e);
          }
        });
      });
      rq.on("error", (e) => (e.code === "ECONNRESET" ? null : reject(e)));
      rq.end();
    });
    assert.strictEqual((await c("POST", "/api/telemetry/beat", { body: { installId: "short" } })).status, 200, "garbage still answers 200");
  });

  await t("hardware facts: whitelisted and capped, junk dropped", () => {
    const hw = live.cleanHw({ brand: "vivo", model: "I2501", abis: ["arm64-v8a"], cores: 8, coreMaxMhz: [2000, 3000], sensors: ["a", "b"], evil: "x", ramMb: 99999999999 });
    assert.strictEqual(hw.brand, "vivo");
    assert.deepStrictEqual(hw.abis, ["arm64-v8a"]);
    assert.strictEqual(hw.evil, undefined);
    assert.strictEqual(hw.ramMb, 1048576);
    assert.strictEqual(live.cleanHw("nope"), null);
  });

  await t("beat makes the phone connected, keeps the last reading and hardware, and pages the list", async () => {
    const geo = require("../src/modules/ops/geo");
    geo._reset();
    geo._setGap(0);
    let asked = 0;
    geo._setProvider(async (ip) => (asked++, { country: "ID", countryName: "Indonesia", city: "Jakarta", region: "Jakarta", isp: "Telkom", timezone: "Asia/Jakarta" }));
    for (let i = 0; i < 12; i++) {
      const id = "install-" + String(i).padStart(8, "0");
      await seen.touchBeat({ installId: id, ip: "114.12.21." + i, userId: null, reading: { cpu: i, at: Date.now() }, hw: i === 0 ? live.cleanHw({ brand: "vivo", model: "I2501" }) : null, build: 24 });
    }
    await new Promise((r) => setTimeout(r, 200));
    const p1 = await seen.list({ page: 1, pageSize: 10 });
    assert.strictEqual(p1.total, 12);
    assert.strictEqual(p1.pages, 2);
    assert.strictEqual(p1.items.length, 10);
    const p2 = await seen.list({ page: 2, pageSize: 10 });
    assert.strictEqual(p2.items.length, 2);
    assert.strictEqual(p2.page, 2);
    assert.ok((await seen.list({ page: 9, pageSize: 10 })).page === 2, "page is clamped");
    const one = seenRows.find((r) => r.installId === "install-00000000");
    assert.strictEqual(one.deviceModel, "I2501");
    assert.strictEqual(one.lastEvent, "beat");
    assert.strictEqual(one.lastLive.cpu, 0);
    assert.ok(one.geo && one.geo.city === "Jakarta" && one.geoIp === "114.12.21.0");
    assert.strictEqual(asked, 12);
    const d = await seen.detail("install-00000000");
    assert.strictEqual(d.device.hw.brand, "vivo");
    assert.strictEqual(d.device.place, "Jakarta, Jakarta, Indonesia");
    assert.strictEqual(d.device.online, true);
    // a phone that went quiet stays in the history, shown offline
    one.lastSeen = new Date(Date.now() - 3600 * 1000);
    assert.strictEqual((await seen.detail("install-00000000")).device.online, false);
    assert.strictEqual((await seen.list({ online: true })).length, 11);
    geo._setProvider(null);
  });

  await t("geo: private addresses are never sent out, answers are cached, failures are quiet", async () => {
    const geo = require("../src/modules/ops/geo");
    geo._reset();
    let n = 0;
    geo._setProvider(async () => (n++, { country: "ID" }));
    assert.strictEqual(await geo.lookup("192.168.1.4"), null);
    assert.strictEqual(await geo.lookup("127.0.0.1"), null);
    assert.strictEqual(await geo.lookup("not-an-ip"), null);
    assert.strictEqual(n, 0);
    await geo.lookup("8.8.8.8");
    await geo.lookup("8.8.8.8");
    assert.strictEqual(n, 1);
    geo._reset();
    geo._setProvider(async () => {
      throw new Error("down");
    });
    assert.strictEqual(await geo.lookup("1.1.1.1"), null);
    geo._setProvider(null);
    geo._reset();
  });

  await t("routes: paged list wraps items; old callers still get a plain array", async () => {
    for (let i = 0; i < 3; i++) await seen.touchBeat({ installId: "install-xx00000" + i, ip: "203.0.113." + i, reading: { cpu: 1, at: Date.now() }, hw: null });
    const old = await c("GET", "/api/ops/devices", { user: boss });
    assert.ok(Array.isArray(old.body.data) && old.body.data.length === 3);
    const paged = await c("GET", "/api/ops/devices?page=1&pageSize=2", { user: boss });
    assert.strictEqual(paged.body.data.items.length, 2);
    assert.strictEqual(paged.body.data.total, 3);
    assert.strictEqual(paged.body.data.items[0].live.cpu, 1);
  });

  srv.close();
  console.log("\n" + pass + " checks passed");
  setTimeout(() => process.exit(process.exitCode || 0), 100);
})();
