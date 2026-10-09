"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { protect } = require("../../middleware/auth");
const { resolve, gate } = require("./access");
const members = require("./members");
const restrict = require("./restrict");
const { createSampler } = require("./metrics");
const seen = require("./seen");
const live = require("./live");
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

router.get("/devices", gate("devices"), async (req, res) => {
  const rows = await seen.list({ q: req.query.q, online: req.query.online === "1", limit: req.query.limit, before: req.query.before });
  const withLive = req.ops.perms.has("live");
  res.json({ success: true, data: rows.map((r) => ({ ...r, live: withLive ? live.read(r.installId) : null })) });
});

router.get("/devices/:installId", gate("devices"), async (req, res) => {
  const d = await seen.detail(req.params.installId);
  if (!d) return res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });
  res.json({ success: true, data: { ...d, live: req.ops.perms.has("live") ? live.read(d.device.installId) : null } });
});

// Live readings of one phone. Watching makes the phone report every 2 s; it
// goes back to once a minute about 30 s after the last viewer leaves.
router.get("/stream/device/:installId", gate("live"), (req, res) => {
  const id = req.params.installId;
  if (!live.idOk(id)) return res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();
  let lastAt = 0;
  let renewAt = 0;
  const write = (obj) => {
    res.write("data: " + JSON.stringify(obj) + "\n\n");
    if (typeof res.flush === "function") res.flush();
  };
  const tick = () => {
    const now = Date.now();
    if (now >= renewAt) {
      live.want(id, now);
      renewAt = now + 5000;
    }
    const r = live.read(id, now);
    if (!r) return write({ type: "waiting" });
    if (r.at !== lastAt) {
      lastAt = r.at;
      write({ type: "reading", reading: r });
    } else if (r.stale) {
      write({ type: "stale", ageMs: r.ageMs });
    }
  };
  const timer = setInterval(tick, 1000);
  res.on("close", () => clearInterval(timer));
  record(req, "device.watch", id, {});
  tick();
});

router.sampler = sampler; // test seam
module.exports = router;
