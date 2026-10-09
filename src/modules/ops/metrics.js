"use strict";

const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { monitorEventLoopDelay } = require("perf_hooks");

const CLK_TCK = 100;
const PAGE = 4096;
const MAX_WATCHERS = 5;
const HISTORY = 300;

// ------------------------------------------------------------------ parsers
/** /proc/stat -> { total:[...], cores:[[...]...] }; each array is the jiffies of one cpu line. */
function parseStat(text) {
  const out = { total: null, cores: [] };
  for (const line of String(text).split("\n")) {
    const m = /^(cpu\d*)\s+(.*)$/.exec(line);
    if (!m) continue;
    const nums = m[2].trim().split(/\s+/).map(Number);
    if (m[1] === "cpu") out.total = nums;
    else out.cores.push(nums);
  }
  return out;
}

/** Percent busy / steal between two jiffy arrays. */
function cpuPct(prev, cur) {
  if (!prev || !cur) return { busy: 0, steal: 0, user: 0, system: 0, iowait: 0 };
  const d = cur.map((v, i) => v - (prev[i] || 0));
  const total = d.slice(0, 8).reduce((a, b) => a + b, 0);
  if (total <= 0) return { busy: 0, steal: 0, user: 0, system: 0, iowait: 0 };
  const idle = (d[3] || 0) + (d[4] || 0);
  const pct = (n) => Math.max(0, Math.min(100, (n / total) * 100));
  return {
    busy: pct(total - idle),
    user: pct((d[0] || 0) + (d[1] || 0)),
    system: pct((d[2] || 0) + (d[5] || 0) + (d[6] || 0)),
    iowait: pct(d[4] || 0),
    steal: pct(d[7] || 0),
  };
}

function parseMeminfo(text) {
  const kb = {};
  for (const line of String(text).split("\n")) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) kb[m[1]] = Number(m[2]) * 1024;
  }
  const total = kb.MemTotal || 0;
  const available = kb.MemAvailable != null ? kb.MemAvailable : (kb.MemFree || 0) + (kb.Buffers || 0) + (kb.Cached || 0);
  return {
    total,
    available,
    used: Math.max(0, total - available),
    free: kb.MemFree || 0,
    cached: (kb.Cached || 0) + (kb.Buffers || 0),
    swapTotal: kb.SwapTotal || 0,
    swapUsed: Math.max(0, (kb.SwapTotal || 0) - (kb.SwapFree || 0)),
  };
}

/** /proc/net/dev -> total rx/tx bytes over every interface except loopback. */
function parseNetDev(text) {
  let rx = 0;
  let tx = 0;
  for (const line of String(text).split("\n")) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m || m[1] === "lo") continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    if (f.length >= 9) {
      rx += f[0] || 0;
      tx += f[8] || 0;
    }
  }
  return { rx, tx };
}

function parseLoad(text) {
  const p = String(text).trim().split(/\s+/);
  const [running, total] = String(p[3] || "0/0").split("/").map(Number);
  return { l1: Number(p[0]) || 0, l5: Number(p[1]) || 0, l15: Number(p[2]) || 0, running: running || 0, threads: total || 0 };
}

/** One /proc/<pid>/stat line -> { pid, name, ticks, rss, state }. The name may contain spaces/parentheses. */
function parseProcStat(pid, text) {
  const s = String(text);
  const a = s.indexOf("(");
  const b = s.lastIndexOf(")");
  if (a < 0 || b < a) return null;
  const f = s.slice(b + 2).split(" ");
  // after ")": state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime ... rss(21)
  const utime = Number(f[11]);
  const stime = Number(f[12]);
  const rssPages = Number(f[21]);
  if (![utime, stime, rssPages].every(Number.isFinite)) return null;
  return { pid: Number(pid), name: s.slice(a + 1, b), state: f[0], ticks: utime + stime, rss: rssPages * PAGE };
}

function parseDiskstats(text) {
  let read = 0;
  let write = 0;
  for (const line of String(text).split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p.length < 14) continue;
    if (/^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|ploop\d+|mmcblk\d+)$/.test(p[2])) {
      read += Number(p[5]) * 512;
      write += Number(p[9]) * 512;
    }
  }
  return { read, write };
}

// ------------------------------------------------------------------ readers (real machine)
const read = (f) => {
  try {
    return fs.readFileSync(f, "utf8");
  } catch (_) {
    return null;
  }
};

function readProcs() {
  const out = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch (_) {
    return out;
  }
  for (const d of dirs) {
    const t = read(`/proc/${d}/stat`);
    const p = t && parseProcStat(d, t);
    if (p) out.push(p);
  }
  return out;
}

const run = (cmd, args, timeout = 2500) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 1 << 20, env: { ...process.env, PM2_HOME: process.env.PM2_HOME || "/root/.pm2" } }, (err, stdout) =>
      resolve(err ? null : String(stdout))
    );
  });

async function readGpu() {
  const out = await run("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"], 1500);
  if (!out) return { available: false };
  const gpus = out
    .trim()
    .split("\n")
    .map((l) => l.split(",").map((s) => s.trim()))
    .filter((p) => p.length >= 5)
    .map((p) => ({ name: p[0], util: Number(p[1]), memUsed: Number(p[2]) * 1048576, memTotal: Number(p[3]) * 1048576, temp: Number(p[4]) }));
  return gpus.length ? { available: true, gpus } : { available: false };
}

async function readPm2() {
  const out = await run("pm2", ["jlist"], 4000);
  if (!out) return null;
  try {
    const start = out.indexOf("[");
    return JSON.parse(out.slice(start)).map((p) => ({
      name: p.name,
      status: p.pm2_env && p.pm2_env.status,
      restarts: p.pm2_env && p.pm2_env.restart_time,
      uptime: p.pm2_env && p.pm2_env.pm_uptime ? Math.max(0, Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000)) : null,
      cpu: p.monit && p.monit.cpu,
      mem: p.monit && p.monit.memory,
    }));
  } catch (_) {
    return null;
  }
}

async function readMongo() {
  try {
    const mongoose = require("mongoose");
    const db = mongoose.connection && mongoose.connection.db;
    if (!db) return null;
    const s = await db.command({ serverStatus: 1 });
    const ops = s.opcounters || {};
    return {
      connections: s.connections ? s.connections.current : null,
      available: s.connections ? s.connections.available : null,
      opcounters: { insert: ops.insert, query: ops.query, update: ops.update, delete: ops.delete, command: ops.command },
      residentMb: s.mem ? s.mem.resident : null,
      uptime: s.uptime,
    };
  } catch (_) {
    return null;
  }
}

function statfs() {
  try {
    const s = fs.statfsSync("/");
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - free };
  } catch (_) {
    return null;
  }
}

// ------------------------------------------------------------------ sampler
/**
 * One shared sampler. It only runs while somebody is watching and takes about
 * a millisecond per tick, so a 1 vCPU / 1 GB machine is not disturbed.
 * `io` can be replaced in tests.
 */
function createSampler(io = {}) {
  const src = {
    stat: () => read("/proc/stat"),
    meminfo: () => read("/proc/meminfo"),
    netdev: () => read("/proc/net/dev"),
    loadavg: () => read("/proc/loadavg"),
    uptime: () => read("/proc/uptime"),
    diskstats: () => read("/proc/diskstats"),
    procs: readProcs,
    statfs,
    gpu: readGpu,
    pm2: readPm2,
    mongo: readMongo,
    now: () => Date.now(),
    ...io,
  };

  const watchers = new Set();
  const history = [];
  let timer = null;
  let prev = null;
  let slow = { procs: [], procAt: 0, pm2: null, pm2At: 0, mongo: null, mongoAt: 0, gpu: { available: false }, gpuAt: 0 };
  let prevProcs = new Map();
  let lagHist = null;
  let busy = false;
  let lastSample = null;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const t = src.now();
      const stat = parseStat(src.stat() || "");
      const mem = parseMeminfo(src.meminfo() || "");
      const net = parseNetDev(src.netdev() || "");
      const load = parseLoad(src.loadavg() || "");
      const disk = parseDiskstats(src.diskstats() || "");
      const dt = prev ? Math.max(0.2, (t - prev.t) / 1000) : 1;

      const cpu = cpuPct(prev && prev.stat.total, stat.total);
      const cores = stat.cores.map((c, i) => cpuPct(prev && prev.stat.cores[i], c).busy);
      const sample = {
        t,
        cpu: { ...cpu, cores, count: stat.cores.length || os.cpus().length || 1 },
        load,
        mem,
        net: { rxBps: prev ? Math.max(0, (net.rx - prev.net.rx) / dt) : 0, txBps: prev ? Math.max(0, (net.tx - prev.net.tx) / dt) : 0, rxTotal: net.rx, txTotal: net.tx },
        disk: {
          ...(src.statfs() || { total: 0, used: 0, free: 0 }),
          readBps: prev ? Math.max(0, (disk.read - prev.disk.read) / dt) : 0,
          writeBps: prev ? Math.max(0, (disk.write - prev.disk.write) / dt) : 0,
        },
        node: {
          rss: process.memoryUsage().rss,
          heapUsed: process.memoryUsage().heapUsed,
          heapTotal: process.memoryUsage().heapTotal,
          lagMs: lagHist ? Math.round((lagHist.mean / 1e6) * 10) / 10 : 0,
          uptime: Math.floor(process.uptime()),
        },
        system: { uptime: Math.floor(Number(String(src.uptime() || "0").split(" ")[0]) || 0), cpus: stat.cores.length || os.cpus().length, kernel: os.release(), platform: os.platform() },
      };
      if (lagHist) lagHist.reset();

      // Heavier readings run less often.
      if (t - slow.procAt >= 3000) {
        const now = src.procs();
        const cur = new Map(now.map((p) => [p.pid, p]));
        const seconds = slow.procAt ? (t - slow.procAt) / 1000 : 3;
        slow.procs = now
          .map((p) => {
            const before = prevProcs.get(p.pid);
            const cpuPctProc = before ? Math.max(0, ((p.ticks - before.ticks) / CLK_TCK / seconds) * 100) : 0;
            return { pid: p.pid, name: p.name, cpu: Math.round(cpuPctProc * 10) / 10, rss: p.rss, state: p.state };
          })
          .sort((a, b) => b.cpu - a.cpu || b.rss - a.rss)
          .slice(0, 10);
        prevProcs = cur;
        slow.procAt = t;
        slow.threads = now.length;
      }
      if (t - slow.pm2At >= 10000) {
        slow.pm2At = t;
        src.pm2().then((v) => (slow.pm2 = v)).catch(() => {});
      }
      if (t - slow.mongoAt >= 5000) {
        slow.mongoAt = t;
        src.mongo().then((v) => (slow.mongo = v)).catch(() => {});
      }
      if (t - slow.gpuAt >= 2000) {
        slow.gpuAt = t;
        src.gpu().then((v) => (slow.gpu = v)).catch(() => {});
      }
      sample.procs = slow.procs;
      sample.processCount = slow.threads || 0;
      sample.pm2 = slow.pm2;
      sample.mongo = slow.mongo;
      sample.gpu = slow.gpu;

      prev = { t, stat, net, disk };
      lastSample = sample;
      history.push(lite(sample));
      if (history.length > HISTORY) history.shift();
      for (const fn of watchers) {
        try {
          fn(sample);
        } catch (_) {
          // a broken watcher must not stop the others
        }
      }
    } finally {
      busy = false;
    }
  }

  const lite = (s) => ({ t: s.t, cpu: Math.round(s.cpu.busy * 10) / 10, mem: s.mem.total ? Math.round((s.mem.used / s.mem.total) * 1000) / 10 : 0, rx: Math.round(s.net.rxBps), tx: Math.round(s.net.txBps) });

  function start() {
    if (timer) return;
    try {
      lagHist = monitorEventLoopDelay({ resolution: 20 });
      lagHist.enable();
    } catch (_) {
      lagHist = null;
    }
    prev = null;
    tick();
    timer = setInterval(tick, 1000);
    timer.unref();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    if (lagHist) lagHist.disable();
    lagHist = null;
  }

  return {
    /** Returns an unsubscribe function, or null when too many people are watching. */
    subscribe(fn) {
      if (watchers.size >= MAX_WATCHERS) return null;
      watchers.add(fn);
      start();
      return () => {
        watchers.delete(fn);
        if (!watchers.size) stop();
      };
    },
    history: () => history.slice(),
    last: () => lastSample,
    watching: () => watchers.size,
    running: () => !!timer,
    tick,
    _stop: stop,
  };
}

module.exports = {
  createSampler,
  parseStat,
  cpuPct,
  parseMeminfo,
  parseNetDev,
  parseLoad,
  parseProcStat,
  parseDiskstats,
  MAX_WATCHERS,
};
