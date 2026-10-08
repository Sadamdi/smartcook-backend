"use strict";

const { DevLogService } = require("./service");
const envelope = require("./crypto");

const service = new DevLogService();

// After old (plaintext) APKs have aged out, set DEVLOG_REQUIRE_ENCRYPTED=1.
const requireEncrypted = () => process.env.DEVLOG_REQUIRE_ENCRYPTED === "1";

let cachedKeys = null;
const serverKeys = () => (cachedKeys = cachedKeys || envelope.loadKeys());

/**
 * Accepts a batch of client debug events.
 *
 * Always answers 200 even when the payload is unusable: telemetry must never
 * be a reason the app shows an error to the user.
 */
async function ingest(req, res) {
  try {
    const body = req.body || {};
    let events;
    if (body.v !== undefined) {
      try {
        events = envelope.open(body, serverKeys()).events;
      } catch (e) {
        if (!(e instanceof envelope.EnvelopeError)) throw e;
        // One answer for every failure, so a probe learns nothing about why.
        console.warn(`[devlog] envelope rejected: ${e.reason}`);
        return res.status(400).json({ success: false, message: "Invalid payload." });
      }
    } else if (requireEncrypted()) {
      return res.status(400).json({ success: false, message: "Invalid payload." });
    } else {
      events = body.events;
    }
    const result = await service.ingest(req, events);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("[devlog] ingest failed:", error.message);
    return res.status(200).json({
      success: true,
      data: { accepted: 0, rejected: 0 },
    });
  }
}

module.exports = { ingest };