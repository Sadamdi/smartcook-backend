"use strict";

// Where an address is, from a free public lookup service. Only members ever
// see the answer, a given address is asked about at most once a day, and a
// failure just leaves the place blank.
const net = require("net");

const DAY_MS = 24 * 60 * 60 * 1000;
const FAIL_MS = 10 * 60 * 1000;
const GAP_MS = 1500; // polite: well under any free-tier limit
const MAX_CACHE = 2000;

const cache = new Map(); // ip -> { at, geo|null }
let chain = Promise.resolve();
let lastCall = 0;
let gap = GAP_MS;

const clip = (v, n) => (typeof v === "string" && v ? v.slice(0, n) : null);

/** Private, loopback and reserved addresses have no place on a map. */
function isPublic(ip) {
  if (typeof ip !== "string") return false;
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::" || s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return false;
    return true;
  }
  return false;
}

/** Default provider: ipwho.is (HTTPS, no key). Returns the fields we keep, or null. */
async function fetchWho(ip) {
  const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,region,city,connection,timezone`, {
    signal: AbortSignal.timeout(4000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) return null;
  const j = await res.json();
  if (!j || j.success === false) return null;
  return {
    country: clip(j.country_code, 4),
    countryName: clip(j.country, 60),
    region: clip(j.region, 60),
    city: clip(j.city, 60),
    isp: clip(j.connection && (j.connection.isp || j.connection.org), 80),
    timezone: clip(j.timezone && j.timezone.id, 60),
  };
}

let provider = fetchWho;

/** Resolves to { country, countryName, region, city, isp, timezone } or null. Never throws. */
function lookup(ip, now = Date.now()) {
  if (!isPublic(ip)) return Promise.resolve(null);
  const hit = cache.get(ip);
  if (hit && now - hit.at < (hit.geo ? DAY_MS : FAIL_MS)) return Promise.resolve(hit.geo);
  const run = chain.then(async () => {
    const wait = gap - (Date.now() - lastCall);
    if (wait > 0 && lastCall) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    let geo = null;
    try {
      geo = await provider(ip);
    } catch (_) {
      geo = null;
    }
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(ip, { at: Date.now(), geo });
    return geo;
  });
  chain = run.catch(() => null);
  return run;
}

function _setProvider(fn) {
  provider = fn || fetchWho;
  lastCall = 0;
}
function _setGap(ms) {
  gap = ms;
}
function _reset() {
  gap = GAP_MS;
  cache.clear();
  chain = Promise.resolve();
  lastCall = 0;
}

module.exports = { lookup, isPublic, _setProvider, _setGap, _reset };
