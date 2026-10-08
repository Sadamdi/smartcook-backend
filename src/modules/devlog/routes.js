"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const controller = require("./controller");
const User = require("../../models/User");
const { ipKey } = require("../../utils/rateLimitKey");

const router = express.Router();

/**
 * 120 batches per hour is generous: the client batches on launch and on
 * errors, and flushes at most a few times a session. The limiter is a safety
 * net against a runaway client, not a quota a real user will meet.
 */
const ingestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => {
    // Silent by design - dropping telemetry must not surface as an error.
    res.status(200).json({ success: true, data: { accepted: 0, rejected: 0 } });
  },
});

/**
 * Identity is a nice-to-have, never a requirement: a launch crash happens
 * before there is a session, and those are exactly the events worth having.
 *
 * `authToken` writes its own 401 response when the header is missing, so it
 * cannot be used as an optional middleware directly - the batch would be
 * rejected before the controller ever ran. Look the session up here instead,
 * and treat every failure as "anonymous".
 */
async function optionalAppToken(req, res, next) {
  req.appToken = null;
  try {
    const header = req.headers["authorization"] || "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) {
      const { AppTokenService } = require("../app-tokens/service");
      req.appToken = await new AppTokenService().lookupAccess(match[1].trim());
    }
  } catch {
    req.appToken = null;
  }
  return next();
}

/**
 * Resolves `X-User-Token` so a log line can be tied to an account ("kok akun
 * saya logout sendiri?"). A missing or expired user token is normal here and
 * never blocks the batch - the event is still worth keeping.
 */
async function optionalUser(req, res, next) {
  req.devUser = null;
  try {
    const raw = req.headers["x-user-token"];
    if (typeof raw === "string" && raw.trim()) {
      const decoded = jwt.verify(raw.trim(), process.env.JWT_SECRET);
      const user = await User.findById(decoded.id)
        .select("_id")
        .lean();
      if (user) req.devUser = user;
    }
  } catch {
    // Anonymous event.
  }
  return next();
}

router.post(
  "/ingest",
  ingestLimiter,
  optionalAppToken,
  optionalUser,
  controller.ingest,
);

module.exports = router;