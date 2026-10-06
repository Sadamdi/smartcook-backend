"use strict";

const { DevLogService } = require("./service");

const service = new DevLogService();

/**
 * Accepts a batch of client debug events.
 *
 * Always answers 200 even when the payload is unusable: telemetry must never
 * be a reason the app shows an error to the user.
 */
async function ingest(req, res) {
  try {
    const events = req.body && req.body.events;
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