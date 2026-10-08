"use strict";

/**
 * Keeps personal data out of raw process logs (PM2 stdout/stderr).
 *
 * - Emails become `email:<hash>`: the same address always maps to the same
 *   token, so "is this one user failing repeatedly?" is still answerable, but
 *   the address itself is not recoverable from the log without the secret.
 * - IPv4 keeps its /24 (`114.12.21.x`), IPv6 its first 3 groups.
 *
 * The developer-log collection (30-day TTL in MongoDB) is separate and goes
 * through the same masking helpers for the IP it stores.
 */

const crypto = require("crypto");

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// 4 octets that are not part of a longer dotted version or a path/UA token.
const IPV4_RE = /(?<![\w/.-])(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}(?![\w.-])/g;
const IPV6_RE = /(?<![\w:])((?:[0-9a-f]{1,4}:){3})(?:[0-9a-f]{0,4}:){1,4}[0-9a-f]{0,4}(?![\w:])/gi;

function secret() {
  return process.env.LOG_HASH_SECRET || process.env.JWT_SECRET || "smartcook-log";
}

function hashToken(value) {
  return crypto
    .createHmac("sha256", secret())
    .update(String(value).trim().toLowerCase())
    .digest("hex")
    .slice(0, 10);
}

function maskIp(value) {
  if (value === null || value === undefined) return value;
  // X-Forwarded-For can be a list; only the first hop is the client.
  const first = String(value).split(",")[0].trim().replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(first)) {
    return first.replace(/\.\d{1,3}$/, ".x");
  }
  if (first.includes(":")) {
    return first.split(":").slice(0, 3).join(":") + "::";
  }
  return first;
}

function redactText(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  return text
    .replace(EMAIL_RE, (m) => `email:${hashToken(m)}`)
    .replace(IPV4_RE, "$1.x")
    .replace(IPV6_RE, "$1:");
}

/** Deep copy with every string redacted and `ip`-named keys masked. */
function redactValue(value, depth = 0, key = "") {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return /^(ip|clientip|remoteaddress)$/i.test(key) ? maskIp(value) : redactText(value);
  }
  if (typeof value !== "object" || depth > 4) return value;
  if (value instanceof Error) return redactText(value.stack || value.message);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1, key));
  // Dates, ObjectIds, Buffers...: leave them to JSON.stringify untouched.
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactValue(v, depth + 1, k);
  return out;
}

let installed = false;

/**
 * Safety net: error messages and stack traces from libraries can carry an
 * email or IP too. Wrap console so nothing reaches PM2 unredacted.
 */
function installConsoleRedaction() {
  if (installed) return;
  installed = true;
  for (const method of ["log", "info", "warn", "error"]) {
    const original = console[method].bind(console);
    console[method] = (...args) =>
      original(...args.map((a) => (typeof a === "string" || a instanceof Error ? redactValue(a) : a)));
  }
}

module.exports = { redactText, redactValue, maskIp, hashToken, installConsoleRedaction };
