"use strict";

/**
 * Verify a Google ID token against the configured audience (s).
 *
 * Mirrors Kelilink's `googleAuth.ts` semantics but adapted to SmartCook's
 * firebase-admin based auth stack. Returns the verified claims; throws an
 * Error with `statusCode` and `code` set so the HTTP layer can map it.
 */

const fs = require("fs");
const path = require("path");
const { admin } = require("../config/firebase");

const VERIFIER_APP = "google-id-token-verifier";

const notConfigured = (message) => {
  const e = new Error(
    message || "Google Sign-In is not configured (Firebase project id missing).",
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

// The Firebase project the *app* signs in against (android/app/google-services.json).
// The ID token's `aud` is that project id, so it is the only thing the verifier
// needs. Verifying a token checks the signature against Google's public keys;
// it never needs a service-account key. Tying verification to whatever
// service-account file happens to sit on the server broke login when that file
// belonged to a different project (smartcook-487714 vs the app's auth-48b22).
const resolveProjectId = () => {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID.trim();
  try {
    const gs = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "google-services.json"), "utf8"),
    );
    return gs.project_info && gs.project_info.project_id;
  } catch (_) {
    return null;
  }
};

const getVerifierAuth = () => {
  let app = admin.apps.find((a) => a && a.name === VERIFIER_APP);
  if (!app) {
    const projectId = resolveProjectId();
    if (!projectId) throw notConfigured();
    app = admin.initializeApp({ projectId }, VERIFIER_APP);
  }
  return app.auth();
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

  const auth = getVerifierAuth();

  let decoded;
  try {
    // No revocation check: it needs a service-account call to Google, and a
    // revoked session is not a login-time concern here.
    decoded = await auth.verifyIdToken(idToken);
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
