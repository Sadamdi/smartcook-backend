"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const live = require("./live");
const seen = require("./seen");

const router = express.Router();

/**
 * Small periodic reading from the app. It sits behind the normal app-session
 * gate, is tiny, and always answers 200 so it can never surface as an error
 * to the person using the phone.
 */
router.post("/beat", async (req, res) => {
  const r = live.beat(req.body);
  if (r.ok && !r.skipped) {
    let userId = null;
    try {
      const raw = req.headers["x-user-token"];
      if (typeof raw === "string" && raw.trim()) userId = jwt.verify(raw.trim(), process.env.JWT_SECRET).id || null;
    } catch (_) {
      userId = null;
    }
    const b = Number(req.headers["x-smartcook-build"]);
    seen.touchBeat({
      installId: req.body.installId,
      ip: req.ip,
      userId,
      reading: live.read(req.body.installId),
      hw: live.takeHw(req.body.installId),
      build: Number.isFinite(b) && b > 0 ? b : null,
    });
  }
  res.json({ success: true, data: { next: r.next || live.SLOW_S, watch: !!r.watch } });
});

module.exports = router;
