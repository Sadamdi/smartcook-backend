"use strict";

const crypto = require("crypto");

/**
 * Rate-limit key helpers.
 *
 * Two things to get right:
 *   1. `express-rate-limit` rejects a key that is a raw IPv6 address
 *      (ERR_ERL_KEY_GEN_IPV6), and IPv6 clients can trivially rotate their
 *      address within their own /64 to sidestep a per-IP cap. Normalising to
 *      a /64 prefix collapses that whole range onto one bucket.
 *   2. The API runs behind a Cloudflare Tunnel, so the client address is the
 *      first hop in `X-Forwarded-For`, not `req.socket.remoteAddress`.
 */

/** Leftmost entry of X-Forwarded-For, or the socket address. */
function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

/**
 * Collapse an IPv6 address to its /64 so a single subscriber cannot rotate
 * addresses to escape a per-IP budget. IPv4 passes through unchanged.
 */
function normalizeIp(ip) {
  if (typeof ip !== "string" || !ip) return "unknown";
  const value = ip.trim().toLowerCase();
  if (value.indexOf(":") === -1) return value; // IPv4 or hostname
  // Strip a zone index (fe80::1%eth0) before parsing.
  const bare = value.split("%")[0];
  const parts = bare.split("::");
  const head = parts[0] ? parts[0].split(":") : [];
  // The /64 is the first four groups of the address.
  const prefix = head.slice(0, 4).filter(Boolean).join(":");
  return prefix ? prefix + "::/64" : "v6-unique";
}

/** Stable per-client key for a rate limiter. */
function ipKey(req) {
  return normalizeIp(clientIp(req));
}

/**
 * Prefer an identity we can trust over an address we cannot: a live app
 * session, then the user JWT, then the client IP. Hashing keeps the token
 * itself out of limiter state (and out of any memory dump of it).
 */
function sessionKey(req) {
  const session = req.appTokenValue;
  if (typeof session === "string" && session.length > 0) {
    return "s:" + crypto.createHash("sha256").update(session).digest("hex").slice(0, 32);
  }
  const user = req.headers["x-user-token"];
  if (typeof user === "string" && user.length > 0) {
    return "u:" + crypto.createHash("sha256").update(user).digest("hex").slice(0, 32);
  }
  return "i:" + ipKey(req);
}

module.exports = { clientIp, normalizeIp, ipKey, sessionKey };
