"use strict";

const net = require("net");
const { Restriction } = require("./models");

const FRESH_MS = 30 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let rules = []; // [{ id, kind, value, reason, until, matcher? }]
let loadedAt = 0;
let loading = null;

/** "::ffff:1.2.3.4" -> "1.2.3.4"; anything else is kept (lower-cased). */
function normalizeIp(ip) {
  const s = String(ip || "").trim().toLowerCase();
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  return m ? m[1] : s;
}

/** Parses "1.2.3.4", "2001:db8::1" or "1.2.3.0/24" (IPv4 prefix 16..32). Null if invalid. */
function parseIpTarget(value) {
  const v = normalizeIp(value);
  if (net.isIP(v)) return { type: net.isIPv4(v) ? "ipv4" : "ipv6", addr: v, prefix: null };
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(v);
  if (m && net.isIPv4(m[1])) {
    const prefix = Number(m[2]);
    if (prefix >= 16 && prefix <= 32) return { type: "ipv4", addr: m[1], prefix };
  }
  return null;
}

function matcherFor(value) {
  const t = parseIpTarget(value);
  if (!t) return null;
  const list = new net.BlockList();
  if (t.prefix !== null && t.prefix < 32) list.addSubnet(t.addr, t.prefix, "ipv4");
  else list.addAddress(t.addr, t.type);
  return { list, type: t.type };
}

function covers(value, ip) {
  const m = matcherFor(value);
  const addr = normalizeIp(ip);
  if (!m || !net.isIP(addr)) return false;
  const type = net.isIPv4(addr) ? "ipv4" : "ipv6";
  return m.type === type && m.list.check(addr, type);
}

async function reload() {
  const rows = await Restriction.find({ active: true }).lean();
  rules = rows.map((r) => ({
    id: String(r._id),
    kind: r.kind,
    value: r.value,
    reason: r.reason || "",
    until: r.until || null,
    matcher: r.kind === "ip" ? matcherFor(r.value) : null,
  }));
  loadedAt = Date.now();
}

/** Cheap on the hot path: reloads at most every 30 s (or right after a change). */
async function fresh() {
  if (Date.now() - loadedAt < FRESH_MS) return;
  if (!loading) {
    loading = reload()
      .catch(() => {
        // Database hiccup: keep serving the previous rules.
        loadedAt = Date.now() - FRESH_MS + 5000;
      })
      .finally(() => {
        loading = null;
      });
  }
  await loading;
}

const live = (r, now = Date.now()) => !r.until || new Date(r.until).getTime() > now;

function ipRestricted(ip) {
  const addr = normalizeIp(ip);
  if (!addr) return null;
  const now = Date.now();
  for (const r of rules) {
    if (r.kind !== "ip" || !live(r, now) || !r.matcher) continue;
    const type = net.isIPv4(addr) ? "ipv4" : net.isIPv6(addr) ? "ipv6" : null;
    if (type && r.matcher.type === type && r.matcher.list.check(addr, type)) return { id: r.id, reason: r.reason, until: r.until };
  }
  return null;
}

function emailRestricted(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  const now = Date.now();
  for (const r of rules) {
    if (r.kind === "email" && r.value === e && live(r, now)) return { id: r.id, reason: r.reason, until: r.until };
  }
  return null;
}

/** Seconds left of a time-limited restriction; null when it has no end. */
function remaining(until, now = Date.now()) {
  if (!until) return null;
  return Math.max(1, Math.ceil((new Date(until).getTime() - now) / 1000));
}

/** What a member sees on a device or person: which rule applies and how long it lasts (null: none). */
function describe(hit) {
  return hit ? { id: hit.id || null, reason: hit.reason || "", remainingSeconds: remaining(hit.until) } : null;
}

function invalidate() {
  loadedAt = 0;
}

/** Test seam. */
function _setRules(list) {
  rules = list.map((r) => ({ ...r, matcher: r.kind === "ip" ? matcherFor(r.value) : null }));
  loadedAt = Date.now();
}

// ---------------------------------------------------------------- express glue
const EXEMPT = (req) => req.path === "/api/health" || (req.method === "GET" && req.path.startsWith("/api/app/"));

/**
 * First gate in the chain (after the language middleware): a restricted
 * address gets one short answer. Only the health probe and the update
 * downloads stay reachable, so a blocked phone can still update the app.
 */
function ipGate() {
  return async (req, res, next) => {
    if (EXEMPT(req)) return next();
    await fresh();
    const hit = ipRestricted(req.ip);
    if (!hit) return next();
    return res.status(403).json({
      success: false,
      code: "IP_BLOCKED",
      message: "Anda telah diblokir dari layanan ini.",
      reason: hit.reason || "",
      until: hit.until || null,
      remainingSeconds: remaining(hit.until),
    });
  };
}

/** For handlers that identify an account (login, register, Google, session check). */
async function suspended(res, email) {
  await fresh();
  const hit = emailRestricted(email);
  if (!hit) return false;
  res.status(403).json({
    success: false,
    code: "ACCOUNT_SUSPENDED",
    message: "Akun ini ditangguhkan.",
    reason: hit.reason || "",
    until: hit.until || null,
    remainingSeconds: remaining(hit.until),
  });
  return true;
}

module.exports = {
  EMAIL,
  normalizeIp,
  parseIpTarget,
  covers,
  ipRestricted,
  emailRestricted,
  invalidate,
  remaining,
  describe,
  fresh,
  ipGate,
  suspended,
  _setRules,
};
