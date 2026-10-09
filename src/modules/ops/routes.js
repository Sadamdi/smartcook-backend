"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { protect } = require("../../middleware/auth");
const { resolve, gate } = require("./access");
const members = require("./members");

const router = express.Router();

// Per user, not per address: members come from the same phones/networks.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : "anon"),
  validate: { keyGeneratorIpFallback: false },
});

// The only route open to every signed-in user. It answers with nothing at all
// for non-members, so the app can ask once without any visible effect.
router.get("/me", protect, async (req, res) => {
  const m = await resolve(req.user);
  res.json({ success: true, data: m ? { role: m.role, perms: [...m.perms] } : null });
});

// Everything below answers 404 (as if it did not exist) unless the database
// says this exact user holds the right.
router.use(protect, limiter, gate());

router.get("/members", gate("members"), members.list);
router.post("/members", gate("members"), members.add);
router.patch("/members/:email", gate("members"), members.update);
router.delete("/members/:email", gate("members"), members.remove);

module.exports = router;
