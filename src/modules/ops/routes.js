"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { protect } = require("../../middleware/auth");
const { resolve, gate } = require("./access");
const members = require("./members");
const restrict = require("./restrict");
const { createSampler } = require("./metrics");
const { record } = require("./access");

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

router.get("/restrictions", gate("restrict"), restrict.list);
router.post("/restrictions", gate("restrict"), restrict.add);
router.delete("/restrictions/:id", gate("restrict"), restrict.lift);

// One shared sampler: it only runs while somebody is watching.
const sampler = createSampler();

router.get("/server", gate("monitor"), (req, res) => {
  res.json({ success: true, data: { sample: sampler.last(), history: sampler.history(), watching: sampler.watching() } });
});

// Live feed, one frame per second (sealed frame by frame by the encrypted channel).
router.get("/stream/server", gate("monitor"), (req, res) => {
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}

`);
    if (typeof res.flush === "function") res.flush();
  };
  let off = null;
  let closed = false;
  const cleanup = () => {
    closed = true;
    if (off) off();
    off = null;
  };
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();
  // The response closes when the client goes away (the request 'close' only
  // means the body was read).
  res.on("close", cleanup);
  send({ type: "history", items: sampler.history() });
  off = sampler.subscribe((sample) => !closed && send({ type: "sample", sample }));
  if (!off) {
    send({ type: "busy" });
    return res.end();
  }
  record(req, "monitor.open", null, {});
});

router.sampler = sampler; // test seam
module.exports = router;
