"use strict";

// Phone-side readings: sparse by default, fast only while somebody watches.
const SLOW_S = 60;
const FAST_S = 2;
const WANT_MS = 30 * 1000; // a watch lapses 30 s after the last renewal
const LIVE_MS = 3 * 60 * 1000; // a reading older than this is stale
const MIN_GAP_MS = 800; // a client cannot flood the endpoint

const latest = new Map(); // installId -> { data, at }
const wanted = new Map(); // installId -> expiry ms
const lastBeat = new Map();

const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};
const bool = (v) => (typeof v === "boolean" ? v : null);

/** Whitelist + clamp: whatever the client sends, only these numbers are kept. */
function clean(body) {
  const b = body && typeof body === "object" ? body : {};
  return {
    cpu: num(b.cpu, 0, 100),
    rssMb: num(b.rssMb, 0, 65536),
    memAvailMb: num(b.memAvailMb, 0, 1048576),
    memTotalMb: num(b.memTotalMb, 0, 1048576),
    lowMem: bool(b.lowMem),
    battery: num(b.battery, 0, 100),
    charging: bool(b.charging),
    tempC: num(b.tempC, -40, 150),
    thermal: num(b.thermal, -1, 6),
    net: num(b.net, 0, 20),
    fg: bool(b.fg),
    storageFreeMb: num(b.storageFreeMb, 0, 1048576),
  };
}

const idOk = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);

function wantFast(installId, now = Date.now()) {
  const until = wanted.get(installId) || 0;
  if (until <= now) {
    wanted.delete(installId);
    return false;
  }
  return true;
}

/** Stores a reading and tells the phone how soon to send the next one. */
function beat(body, now = Date.now()) {
  const installId = body && body.installId;
  if (!idOk(installId)) return { ok: false };
  if (now - (lastBeat.get(installId) || 0) < MIN_GAP_MS) return { ok: true, next: wantFast(installId, now) ? FAST_S : SLOW_S, watch: wantFast(installId, now), skipped: true };
  lastBeat.set(installId, now);
  latest.set(installId, { data: clean(body), at: now });
  if (latest.size > 5000) {
    for (const [k, v] of latest) if (now - v.at > LIVE_MS) latest.delete(k);
    lastBeat.clear();
  }
  const watch = wantFast(installId, now);
  return { ok: true, next: watch ? FAST_S : SLOW_S, watch };
}

/** An admin is looking at this phone: ask it to report quickly for the next 30 s. */
function want(installId, now = Date.now()) {
  if (idOk(installId)) wanted.set(installId, now + WANT_MS);
}

function read(installId, now = Date.now()) {
  const v = latest.get(installId);
  if (!v) return null;
  return { ...v.data, at: v.at, ageMs: now - v.at, stale: now - v.at > LIVE_MS };
}

/** Installs that reported in the last three minutes (the "connected now" list). */
function connected(now = Date.now()) {
  const out = [];
  for (const [installId, v] of latest) if (now - v.at <= LIVE_MS) out.push({ installId, ...v.data, at: v.at });
  return out;
}

function _reset() {
  latest.clear();
  wanted.clear();
  lastBeat.clear();
}

module.exports = { beat, want, read, connected, wantFast, clean, idOk, SLOW_S, FAST_S, WANT_MS, LIVE_MS, _reset };
