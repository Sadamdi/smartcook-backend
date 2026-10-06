"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const controller = require("./controller");
const { authToken } = require("../../middleware/authToken");
const { assertConfigured } = require("./schema");
const { ipKey } = require("../../utils/rateLimitKey");

const router = express.Router();

/**
 * Both limiters key on the normalised client IP (see utils/rateLimitKey):
 * X-Forwarded-For is the real client address behind the Cloudflare Tunnel,
 * IPv6 is collapsed to its /64 so one subscriber cannot rotate addresses to
 * escape the budget, and express-rate-limit refuses raw IPv6 keys.
 */
const handshakeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      code: "HANDSHAKE_RATE_LIMITED",
      message: "Terlalu banyak percobaan handshake. Coba lagi nanti.",
    });
  },
});

/** 120 refreshes per hour: an app refreshes at most a few times a day. */
const refreshLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      code: "REFRESH_RATE_LIMITED",
      message: "Terlalu banyak permintaan refresh. Coba lagi nanti.",
    });
  },
});

/** Guard so a misconfigured deployment fails loudly on the first call. */
function requireConfig(req, res, next) {
  try {
    assertConfigured();
    return next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: error.code || "APP_TOKENS_NOT_CONFIGURED",
      message: error.message,
    });
  }
}

function validateHandshakeBody(req, res, next) {
  const cert = req.headers["x-smartcook-cert"];
  if (!cert || !String(cert).trim()) {
    return res.status(400).json({
      success: false,
      code: "CERT_MISSING",
      message: "Header X-Smartcook-Cert wajib diisi.",
    });
  }
  return next();
}

function validateRefreshBody(req, res, next) {
  const { refresh } = req.body || {};
  if (!refresh || typeof refresh !== "string") {
    return res.status(400).json({
      success: false,
      code: "REFRESH_MISSING",
      message: "Field refresh wajib diisi.",
    });
  }
  if (refresh.length > 512) {
    return res.status(400).json({
      success: false,
      code: "REFRESH_INVALID",
      message: "Refresh token terlalu panjang.",
    });
  }
  return next();
}

// handshake: cert-gated, no prior token. This is the bootstrap path.
router.post(
  "/handshake",
  requireConfig,
  handshakeLimiter,
  validateHandshakeBody,
  controller.handshake
);

// refresh: single-use refresh token, no prior access token required.
router.post(
  "/refresh",
  requireConfig,
  refreshLimiter,
  validateRefreshBody,
  controller.refresh
);

// revoke: requires the access token it is revoking, so a caller can only
// end its own session.
router.delete("/revoke", authToken, controller.revoke);

module.exports = router;
