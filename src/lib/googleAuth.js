"use strict";

/**
 * Verify a Google ID token against the configured audience (s).
 *
 * Mirrors Kelilink's `googleAuth.ts` semantics but adapted to SmartCook's
 * firebase-admin based auth stack. Returns the verified claims; throws an
 * Error with `statusCode` and `code` set so the HTTP layer can map it.
 */

const { admin, initFirebase } = require("../config/firebase");

const notConfigured = (message) => {
  const e = new Error(
    message || "Google Sign-In is not configured (admin not initialized).",
  );
  e.statusCode = 500;
  e.code = "GOOGLE_AUTH_NOT_CONFIGURED";
  return e;
};

const unauthorized = (message) => {
  const e = new Error(message || "Invalid or expired Google ID token.");
  e.statusCode = 401;
  e.code = "INVALID_GOOGLE_TOKEN";
  return e;
};

// Try hard to make sure firebase-admin is initialized. The legacy
// `googleAuth` controller import never called initFirebase(), so the
// server used to fall back to whatever default app existed. Mirror that
// behavior here, but be defensive: explicitly trigger init when we have a
// usable config and otherwise treat the request as "not configured".
let adminEnsured = false;
const ensureAdmin = () => {
  if (adminEnsured) return;
  if (admin.apps && admin.apps.length > 0) {
    adminEnsured = true;
    return;
  }
  try {
    initFirebase();
    adminEnsured = true;
  } catch (_) {
    adminEnsured = false;
  }
};

const isAdminReady = () => {
  ensureAdmin();
  return Boolean(
    admin && admin.apps && admin.apps.length > 0 && typeof admin.auth === "function",
  );
};

const getGoogleClientIds = () => {
  const raw = process.env.GOOGLE_CLIENT_IDS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const isAudienceAllowed = (aud) => {
  if (!aud) return false;
  const ids = getGoogleClientIds();
  if (ids.length === 0) {
    // No explicit allowlist configured: accept any audience for now so
    // existing Firebase Auth flows continue to work. The token signature
    // + expiry are still verified by firebase-admin.
    return true;
  }
  const audiences = Array.isArray(aud) ? aud : [aud];
  return audiences.some((a) => ids.includes(a));
};

/**
 * Verify a Firebase / Google ID token using firebase-admin. The returned
 * payload is the source of truth for the caller's identity; do NOT trust
 * anything sent in the request body.
 *
 * @param {string} idToken raw ID token from the client
 * @returns {Promise<object>} decoded token claims
 */
const verifyGoogleIdToken = async (idToken) => {
  if (!idToken || typeof idToken !== "string") {
    throw unauthorized("ID token wajib diisi.");
  }

  if (!isAdminReady()) {
    throw notConfigured(
      "Google Sign-In is not configured (firebase-admin belum diinisialisasi).",
    );
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken, true);
  } catch (err) {
    // firebase-admin raises on expired/invalid/revoked tokens.
    throw unauthorized(
      `Google ID token tidak valid atau sudah kedaluwarsa${
        err && err.message ? `: ${err.message}` : "."
      }`,
    );
  }

  if (!decoded || !decoded.uid) {
    throw unauthorized("Google ID token tidak memiliki subject (uid).");
  }

  if (!isAudienceAllowed(decoded.aud)) {
    throw unauthorized(
      "Audience Google ID token tidak termasuk yang diizinkan (GOOGLE_CLIENT_IDS).",
    );
  }

  return {
    sub: decoded.uid,
    uid: decoded.uid,
    email: decoded.email || null,
    email_verified: Boolean(decoded.email_verified),
    name: decoded.name || null,
    picture: decoded.picture || null,
    aud: decoded.aud,
    iss: decoded.iss,
    exp: decoded.exp,
    iat: decoded.iat,
  };
};

module.exports = {
  verifyGoogleIdToken,
  getGoogleClientIds,
};
