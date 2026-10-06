"use strict";

const { AppTokenService } = require("../modules/app-tokens/service");
const { logEvent } = require("../utils/logger");

const tokenService = new AppTokenService();

/**
 * Transitional gate for builds that predate the app-session tokens.
 *
 * Those builds (released before 1.0.4) send the static `x-api-key` that used
 * to be baked into the APK. They must keep working long enough to reach
 * `/api/app/version` and auto-update onto a build that handshakes properly,
 * otherwise deploying the new gate would lock every existing install out.
 *
 * The window is governed by `APP_LEGACY_KEY_UNTIL` (ISO-8601). Once that
 * moment passes the key stops being accepted automatically; there is no
 * background job needed because the check happens per request.
 *
 * When the window closes, delete `src/middleware/apiKey.js` and the
 * `legacyApiKeyAccepted` branch below.
 */
function isLegacyApiKeyAccepted(req) {
  const until = process.env.APP_LEGACY_KEY_UNTIL;
  if (!until || !until.trim()) return false;
  const deadline = Date.parse(until.trim());
  if (Number.isNaN(deadline)) return false;
  if (Date.now() > deadline) return false;

  const expected = process.env.API_KEY;
  const presented = req.headers["x-api-key"];
  if (!expected || !presented) return false;

  const ok = String(presented) === String(expected);
  if (!ok) {
    logEvent("legacy_api_key_rejected", {
      ip: req.headers["x-forwarded-for"] || req.ip,
      method: req.method,
      path: req.originalUrl || req.url,
      success: false,
      statusCode: 403,
    });
  }
  return ok;
}

function legacyDeadlineInfo() {
  const until = process.env.APP_LEGACY_KEY_UNTIL;
  if (!until || !until.trim()) return "disabled";
  const deadline = Date.parse(until.trim());
  if (Number.isNaN(deadline)) return "invalid";
  return Date.now() > deadline ? "expired" : "open until " + until.trim();
}

/** True while the pre-1.0.4 compatibility window is still open. */
function legacyWindowOpen() {
  const until = process.env.APP_LEGACY_KEY_UNTIL;
  if (!until || !until.trim()) return false;
  const deadline = Date.parse(until.trim());
  return !Number.isNaN(deadline) && Date.now() <= deadline;
}

/**
 * A JWT has three dot-separated segments; an app token is opaque base64url.
 * Used only to recognise a *shape*, never to trust the contents: `protect`
 * still verifies the signature before any user data is touched.
 */
function looksLikeJwt(value) {
  return typeof value === "string" && value.split(".").length === 3;
}

/**
 * Gate for every authenticated API call, replacing the static `x-api-key`.
 *
 * Reads `Authorization: Bearer <access>` and resolves it to a live session in
 * MongoDB. On success it attaches the session to `req.appToken` and the raw
 * token to `req.appTokenValue` (the latter is needed by /api/auth/revoke so
 * a caller can only revoke its own session).
 *
 * User identity is unaffected: routes that need a real account still use the
 * `protect` middleware with the JWT from login/register.
 */
async function authToken(req, res, next) {
  try {
    const header = req.headers["authorization"] || "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());

    if (!match) {
      // Transitional: let a pre-1.0.4 build through on its baked-in key.
      if (isLegacyApiKeyAccepted(req)) {
        req.appToken = null;
        req.appTokenValue = null;
        req.legacyClient = true;
        return next();
      }

      return res.status(401).json({
        success: false,
        code: "TOKEN_MISSING",
        message:
          "Access token tidak dikirim. Kirim header Authorization: Bearer <token>.",
      });
    }

    const access = match[1].trim();

    // Transitional: builds before 1.0.4 carried the *user* JWT in
    // `Authorization` and had no app session. Inside the window we let those
    // requests continue so they can reach /api/app/version and update. The
    // value is only inspected for shape here; `protect` performs the real
    // signature check on whatever it finds.
    if (legacyWindowOpen() && looksLikeJwt(access)) {
      req.appToken = null;
      req.appTokenValue = null;
      req.legacyClient = true;
      req.legacyBearerJwt = access;
      return next();
    }

    // Throws 401 TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_MISSING. The response
    // lets the client tell "refresh me" apart from "handshake again".
    const session = await tokenService.lookupAccess(access);

    req.appToken = session;
    req.appTokenValue = access;
    req.appTokenDoc = {
      jti: session.jti,
      build: session.build,
      abi: session.abi,
      certSha256: session.certSha256,
      expiresAt: session.expiresAt,
      refreshExpiresAt: session.refreshExpiresAt,
    };

    return next();
  } catch (error) {
    const status = error.statusCode || 401;
    return res.status(status).json({
      success: false,
      code: error.code || "TOKEN_INVALID",
      message:
        error.message ||
        "Access token tidak valid. Minta sesi baru melalui /api/auth/handshake.",
    });
  }
}

module.exports = {
  authToken,
  isLegacyApiKeyAccepted,
  legacyDeadlineInfo,
  legacyWindowOpen,
  looksLikeJwt,
};
