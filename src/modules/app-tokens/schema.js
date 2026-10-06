"use strict";

/**
 * Token primitives for the double-token scheme that replaces the static
 * `x-api-key`.
 *
 * Design notes (why it looks like this):
 *   - Both tokens are opaque random strings, NOT self-describing JWTs. The
 *     server keeps the only copy (hashed) in MongoDB, so a leaked token
 *     carries no claims and cannot be forged offline.
 *   - Only the SHA-256 of each token is persisted. A database dump alone
 *     does not let an attacker authenticate.
 *   - Rotation keeps the previous secret in `APP_TOKENS_PREVIOUS_SECRET`
 *     for a grace window so tokens issued just before a rotation keep
 *     working until they naturally expire.
 *   - Rotation never happens automatically on restart; it is an explicit
 *     operator action (`scripts/rotate-app-tokens.js`).
 */

const crypto = require("crypto");

const TOKEN_BYTES = 32; // 256 bits of entropy per token
const HASH_ALGO = "sha256";

function notConfigured(message) {
  const e = new Error(message || "APP_TOKENS_SECRET belum diset.");
  e.statusCode = 500;
  e.code = "APP_TOKENS_NOT_CONFIGURED";
  return e;
}

function currentSecret() {
  const secret = process.env.APP_TOKENS_SECRET;
  if (!secret || !secret.trim()) throw notConfigured();
  return secret.trim();
}

/** Generate a fresh opaque token: base64url of 32 random bytes. */
function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Hash a token for storage / lookup. Never store the raw value. */
function hashToken(token) {
  return crypto.createHash(HASH_ALGO).update(String(token)).digest("hex");
}

/**
 * Prove possession of a token without storing it: the server answers with an
 * HMAC over the token keyed by the current secret. The client cannot verify
 * this locally (it never had the secret), so it is only used server-side for
 * auditing; kept minimal on purpose.
 */
function proofFor(token) {
  return crypto
    .createHmac(HASH_ALGO, currentSecret())
    .update(`proof:${token}`)
    .digest("base64url");
}

function accessTtlSeconds() {
  const n = Number(process.env.APP_ACCESS_TTL_SECONDS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 24 * 60 * 60;
}

function refreshTtlSeconds() {
  const n = Number(process.env.APP_REFRESH_TTL_SECONDS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7 * 24 * 60 * 60;
}

function keyIndex() {
  const n = Number(process.env.APP_TOKENS_KEY_INDEX);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

function lastRotatedAt() {
  const raw = process.env.APP_TOKENS_LAST_ROTATED_AT;
  return raw && raw.trim() ? raw.trim() : null;
}

function hasPreviousSecret() {
  const prev = process.env.APP_TOKENS_PREVIOUS_SECRET;
  return Boolean(prev && prev.trim());
}

/** Assert the deployment has a usable secret before serving traffic. */
function assertConfigured() {
  const secret = currentSecret();
  if (secret.length < 32) {
    throw notConfigured(
      `APP_TOKENS_SECRET terlalu pendek (${secret.length} karakter, minimal 32).`,
    );
  }
  if (secret.includes("PLACEHOLDER") || secret.includes("CHANGE_ME")) {
    throw notConfigured("APP_TOKENS_SECRET masih placeholder.");
  }
  return true;
}

module.exports = {
  TOKEN_BYTES,
  HASH_ALGO,
  generateToken,
  hashToken,
  proofFor,
  currentSecret,
  accessTtlSeconds,
  refreshTtlSeconds,
  keyIndex,
  lastRotatedAt,
  hasPreviousSecret,
  assertConfigured,
  notConfigured,
};