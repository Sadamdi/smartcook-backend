"use strict";

const express = require("express");
const live = require("./live");

const router = express.Router();

/**
 * Small periodic reading from the app. It sits behind the normal app-session
 * gate, is tiny, and always answers 200 so it can never surface as an error
 * to the person using the phone.
 */
router.post("/beat", (req, res) => {
  const r = live.beat(req.body);
  res.json({ success: true, data: { next: r.next || live.SLOW_S, watch: !!r.watch } });
});

module.exports = router;
