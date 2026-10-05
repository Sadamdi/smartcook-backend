"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const controller = require("./controller");

const router = express.Router();

// Public (the update check runs before login). Each version check is capped
// at 120 / hour so an offline attacker can't drain CPU by polling.
const versionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: "Terlalu banyak permintaan. Coba lagi nanti.",
    });
  },
});

router.get("/version", versionLimiter, controller.getVersion);
router.get("/download", controller.downloadApk);

module.exports = router;