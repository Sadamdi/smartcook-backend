// node scripts/test-monitor.js : server readings + the live feed. No database.
process.env.OPS_OWNERS = "boss@example.com";

const assert = require("assert");
const http = require("http");
const path = require("path");
const express = require("express");

const stub = (rel, exports) => {
  const id = require.resolve(path.join("..", rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const trail = [];
stub("src/modules/ops/models", {
  Member: { findOne: () => ({ lean: async () => null }) },
  Restriction: { find: () => ({ lean: async () => [] }) },
  Trail: { create: async (d) => trail.push(d) },
  TRAIL_DAYS: 180,
  DAY: 86400000,
});
stub("src/middleware/auth", {
  protect: (req, res, next) => {
    const raw = req.headers["x-user-token"];
    if (!raw) return res.status(401).json({ success: false });
    req.user = JSON.parse(raw);
    next();
  },
});

const M = require("../src/modules/ops/metrics");
const secure = require("../src/modules/secure/channel");
const routes = require("../src/modules/ops/routes");

let pass = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log("ok  -", name);
  } catch (e) {
    console.error("FAIL -", name, "\n   ", e.stack.split("\n").slice(0, 3).join("\n    "));
    process.exitCode = 1;
  }
};

const quiet = () => ({
  stat: () => "",
  meminfo: () => "",
  netdev: () => "",
  loadavg: () => "",
  uptime: () => "",
  diskstats: () => "",
  procs: () => [],
  statfs: () => null,
  gpu: async () => ({ available: false }),
  pm2: async () => null,
  mongo: async () => null,
});

(async () => {
  await t("cpu percentages from two /proc/stat readings", () => {
    const a = M.parseStat("cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 50 0 25 400 25 0 0 0 0 0\nintr 1\n");
    const b = M.parseStat("cpu  200 0 100 880 70 0 0 0 0 0\ncpu0 100 0 50 440 35 0 0 0 0 0\nintr 2\n");
    const p = M.cpuPct(a.total, b.total);
    assert.strictEqual(Math.round(p.busy), 60);
    assert.strictEqual(Math.round(p.user), 40);
    assert.strictEqual(Math.round(p.system), 20);
    assert.strictEqual(Math.round(p.iowait), 8);
    assert.strictEqual(a.cores.length, 1);
    assert.deepStrictEqual(M.cpuPct(null, b.total), { busy: 0, steal: 0, user: 0, system: 0, iowait: 0 });
    assert.strictEqual(M.cpuPct(a.total, a.total).busy, 0, "no time passed");
  });

  await t("memory, network, load, disk readings", () => {
    const mem = M.parseMeminfo("MemTotal:    1024000 kB\nMemFree:      200000 kB\nMemAvailable: 600000 kB\nBuffers: 1000 kB\nCached: 99000 kB\nSwapTotal: 2000 kB\nSwapFree: 500 kB\n");
    assert.strictEqual(mem.total, 1024000 * 1024);
    assert.strictEqual(mem.used, (1024000 - 600000) * 1024);
    assert.strictEqual(mem.swapUsed, 1500 * 1024);
    const noAvail = M.parseMeminfo("MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 150 kB\n");
    assert.strictEqual(noAvail.available, 300 * 1024, "old kernels without MemAvailable");
    const net = M.parseNetDev(
      "Inter-|   Receive |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n" +
        "    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0\n  eth0: 1000 5 0 0 0 0 0 0 2000 6 0 0 0 0 0 0\n venet0: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0\n"
    );
    assert.deepStrictEqual(net, { rx: 1010, tx: 2020 });
    assert.deepStrictEqual(M.parseLoad("0.52 0.34 0.20 2/118 12345\n"), { l1: 0.52, l5: 0.34, l15: 0.2, running: 2, threads: 118 });
    const d = M.parseDiskstats("   8  0 sda 10 0 100 0 20 0 200 0 0 0 0\n   8  1 sda1 5 0 50 0 5 0 50 0 0 0 0\n");
    assert.deepStrictEqual(d, { read: 100 * 512, write: 200 * 512 }, "whole disks only, partitions not double counted");
  });

  await t("a process line with spaces and brackets in its name is read correctly", () => {
    const p = M.parseProcStat("123", "123 (node (x) y) S 1 123 123 0 -1 4194304 11 0 0 0 500 300 0 0 20 0 11 0 12345 987654 5000 18446744073709551615 1 1 0");
    assert.deepStrictEqual(p, { pid: 123, name: "node (x) y", state: "S", ticks: 800, rss: 5000 * 4096 });
    assert.strictEqual(M.parseProcStat("1", "garbage"), null);
  });

  await t("sampler: rates, per-process cpu, slow readings, shared by watchers, stops when unwatched", async () => {
    let n = 0;
    let clock = 1000000;
    let procCalls = 0;
    const s = M.createSampler({
      ...quiet(),
      now: () => (clock += 1000),
      // every reading adds 100 user + 50 system + 80 idle + 20 iowait jiffies: 60% busy
      stat: () => {
        const k = n++;
        const line = "cpu  " + (100 + 100 * k) + " 0 " + (50 + 50 * k) + " " + (800 + 80 * k) + " " + (50 + 20 * k) + " 0 0 0 0 0\n";
        return line + line.replace("cpu ", "cpu0");
      },
      meminfo: () => "MemTotal: 1000 kB\nMemAvailable: 400 kB\n",
      netdev: () => "  eth0: " + n * 1000 + " 1 0 0 0 0 0 0 " + n * 3000 + " 1 0 0 0 0 0 0\n",
      loadavg: () => "1.00 0.50 0.25 1/50 1\n",
      uptime: () => "123.45 100.0\n",
      procs: () => {
        procCalls++;
        return [
          { pid: 7, name: "node", state: "S", ticks: procCalls * 100, rss: 1 << 20 },
          { pid: 8, name: "idle", state: "S", ticks: 0, rss: 1 << 10 },
        ];
      },
      statfs: () => ({ total: 100, used: 40, free: 60 }),
      pm2: async () => [{ name: "app", status: "online" }],
    });
    const a = [];
    const b = [];
    const offA = s.subscribe((x) => a.push(x));
    const offB = s.subscribe((x) => b.push(x));
    assert.ok(s.running());
    await s.tick();
    await s.tick();
    await s.tick();
    // the first sample is taken the moment the first watcher subscribes, so B joins one sample later
    assert.ok(a.length >= 3 && b.length === a.length - 1, "every watcher gets every sample after joining");
    const last = a[a.length - 1];
    assert.strictEqual(Math.round(last.cpu.busy), 60);
    assert.strictEqual(last.mem.used, 600 * 1024);
    assert.strictEqual(last.disk.used, 40);
    assert.ok(last.net.rxBps > 0 && last.net.txBps > last.net.rxBps);
    assert.strictEqual(last.system.uptime, 123);
    assert.strictEqual(last.gpu.available, false);
    assert.strictEqual(last.procs[0].name, "node");
    assert.ok(procCalls <= 3, "the process table is read about every 3 s, not every tick: " + procCalls);
    assert.ok(s.history().length >= 3 && s.last() === last);
    offA();
    assert.ok(s.running(), "still watched by B");
    offB();
    assert.ok(!s.running(), "nobody watching: no timer, no cost");
  });

  await t("sampler: too many watchers are turned away", () => {
    const s = M.createSampler(quiet());
    const offs = [];
    for (let i = 0; i < M.MAX_WATCHERS; i++) offs.push(s.subscribe(() => {}));
    assert.strictEqual(s.subscribe(() => {}), null);
    offs.forEach((o) => o());
    s._stop();
  });

  // ------------------------------------------------ the live feed through the encrypted channel
  const kp = secure.generateKeyPair();
  const keys = secure.loadKeys({ API_PRIVATE_KEY: kp.privateKey });
  const app = express();
  app.use(express.json());
  app.use(secure.middleware({ getKeys: () => keys, requireEncrypted: () => false }));
  app.use("/api/ops", routes);
  const srv = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const port = srv.address().port;
  const boss = JSON.stringify({ _id: "b", email: "boss@example.com", firebase_uid: "u" });
  const normal = JSON.stringify({ _id: "n", email: "n@example.com", firebase_uid: "u" });

  const openStream = (user, frames) =>
    new Promise((resolve, reject) => {
      const { envelope, ctx } = secure.clientSeal({ method: "GET", url: "/api/ops/stream/server", headers: { "x-user-token": user } }, kp.publicKey);
      const data = JSON.stringify(envelope);
      const got = [];
      let buf = "";
      let idx = 0;
      const rq = http.request({ port, path: "/api/secure", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (res) => {
        if (!/event-stream/.test(res.headers["content-type"] || "")) {
          let b = "";
          res.on("data", (c) => (b += c));
          return res.on("end", () => resolve({ status: res.statusCode, plain: b, ctx }));
        }
        res.on("data", (c) => {
          buf += c;
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const line = buf.slice(0, i).replace(/^data: /, "");
            buf = buf.slice(i + 2);
            if (!line) continue;
            got.push(JSON.parse(secure.clientOpenFrame(line, ctx, idx++).toString("utf8").replace(/^data: /, "").trim()));
            if (got.length >= frames) {
              rq.destroy();
              return resolve({ status: 200, got });
            }
          }
        });
      });
      rq.on("error", (e) => (e.code === "ECONNRESET" ? null : reject(e)));
      rq.end(data);
    });

  await t("live feed: sealed frame by frame, history first, then a new sample about every second", async () => {
    const r = await openStream(boss, 3);
    assert.strictEqual(r.got[0].type, "history");
    assert.strictEqual(r.got[1].type, "sample");
    assert.strictEqual(r.got[2].type, "sample");
    assert.ok(r.got[2].sample.t > r.got[1].sample.t, "time moves on");
    assert.ok(r.got[1].sample.mem && r.got[1].sample.cpu && r.got[1].sample.net && r.got[1].sample.gpu);
    await new Promise((x) => setTimeout(x, 200));
    assert.strictEqual(routes.sampler.watching(), 0, "closing the stream stops the sampler");
    assert.ok(!routes.sampler.running());
    assert.ok(trail.some((x) => x.action === "monitor.open"), "opening the feed is written to the trail");
  });

  await t("live feed: a normal user gets the plain 404 of an unknown route, nothing is sampled", async () => {
    const r = await openStream(normal, 1);
    assert.strictEqual(r.status, 200); // the channel itself answers 200, the real status is inside
    const body = JSON.parse(secure.clientOpenResponse(JSON.parse(r.plain), r.ctx).b);
    assert.strictEqual(body.success, false);
    assert.strictEqual(routes.sampler.watching(), 0);
    assert.ok(!routes.sampler.running());
  });

  srv.close();
  console.log("\n" + pass + " checks passed");
})();
