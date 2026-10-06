"use strict";

const DevLog = require("./model");

/** How long a debug log is kept. MongoDB deletes rows past `expiresAt`. */
const RETENTION_DAYS = Number(process.env.DEVLOG_RETENTION_DAYS || 30);

const MAX_BATCH = 50;
const MAX_STRING = 300;
const MAX_ERROR = 1500;
const MAX_META_BYTES = 4096;

/** Only these event names are stored, to stop a client filling the DB. */
const ALLOWED_EVENTS = new Set([
  "app_launch",
  "app_resume",
  "app_pause",
  "locale_change",
  "theme_change",
  "render_error",
  "unhandled_error",
  "screen_view",
  "action",
  "api_error",
  "network_error",
  "session_state",
  "update_check",
  "update_result",
  "crash_report",
]);

const ALLOWED_LEVELS = new Set(["debug", "info", "warn", "error", "fatal"]);

/**
 * Wire keys.
 *
 * The client sends single-letter keys instead of field names, so the payload
 * does not spell out what is being collected when the APK is unpacked. This is
 * obscurity, not security - see the note in the client. Real protection is
 * the validation below plus server-side allow-listing.
 *
 * If you change a key here, change `_kEvent` and friends in
 * `smartcook-frontend/lib/core/services/dev_log.dart` to match.
 */
const WIRE = {
  event: "e",
  installId: "i",
  appVersion: "v",
  appBuild: "b",
  platform: "p",
  osVersion: "o",
  sdkInt: "s",
  deviceModel: "m",
  deviceManufacturer: "f",
  abi: "a",
  locale: "l",
  action: "n",
  level: "y",
  error: "x",
  durationMs: "d",
  statusCode: "c",
  meta: "q",
  ts: "t",
};

/**
 * Accepts either the short wire key or the long name, so a hand-written curl
 * during debugging is not silently dropped. Unknown keys are ignored.
 */
function field(raw, name) {
  const k = WIRE[name];
  if (k != null && raw[k] !== undefined) return raw[k];
  return raw[name];
}

function truncate(value, max) {
  if (value === null || value === undefined) return null;
  const s = typeof value === "string" ? value : String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Drops anything that cannot survive a JSON round-trip cleanly, and keeps
 * `meta` inside a size budget so one bad client cannot post a megabyte.
 */
function sanitiseMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const out = {};
  let bytes = 0;
  for (const [key, value] of Object.entries(meta)) {
    if (bytes > MAX_META_BYTES) break;
    const k = String(key).slice(0, 40);
    let v = value;
    if (v !== null && typeof v === "object") {
      try {
        v = JSON.parse(JSON.stringify(v));
      } catch {
        v = null;
      }
    }
    if (typeof v === "string") v = truncate(v, MAX_STRING);
    else if (v === undefined) v = null;
    else if (typeof v === "number" && !Number.isFinite(v)) v = null;
    const encoded = JSON.stringify(v) || "null";
    bytes += encoded.length + k.length;
    out[k] = v;
  }
  return out;
}

class DevLogService {
  /**
   * @param {object} req       express request (for the server-side view)
   * @param {Array<object>} events  client-reported events
   * @returns {{accepted:number, rejected:number}}
   */
  async ingest(req, events) {
    if (!Array.isArray(events) || events.length === 0) {
      return { accepted: 0, rejected: 0 };
    }

    // A batch larger than the cap is truncated rather than rejected: dropping
    // the whole batch would lose the earliest events, which are usually the
    // interesting ones (launch, then failure).
    const batch = events.slice(0, MAX_BATCH);
    const cert = (req.headers["x-smartcook-cert"] || "").trim() || null;
    const ip = req.headers["x-forwarded-for"] || req.ip || null;
    const userAgent = req.headers["user-agent"] || null;

    // Identity comes from the verified token, never from the payload, so a
    // client cannot log events as somebody else.
    const auth = req.appToken || null;
    const user = req.devUser || null;
    const docs = [];

    for (const raw of batch) {
      if (!raw || typeof raw !== "object") continue;
      const event = truncate(field(raw, "event"), 60);
      if (!event || !ALLOWED_EVENTS.has(event)) continue;

      const level = field(raw, "level");

      docs.push({
        installId: truncate(field(raw, "installId"), 64),
        event,
        userId: user && user._id ? String(user._id) : null,
        userName: user && user.name ? truncate(user.name, MAX_STRING) : null,
        userEmail: user && user.email ? truncate(user.email, MAX_STRING) : null,
        appVersion: truncate(field(raw, "appVersion"), 40),
        appBuild: num(field(raw, "appBuild")),
        platform: truncate(field(raw, "platform"), 40),
        osVersion: truncate(field(raw, "osVersion"), 40),
        sdkInt: num(field(raw, "sdkInt")),
        deviceModel: truncate(field(raw, "deviceModel"), 80),
        deviceManufacturer: truncate(field(raw, "deviceManufacturer"), 80),
        abi: truncate(field(raw, "abi"), 20),
        locale: truncate(field(raw, "locale"), 20),
        ip,
        userAgent: truncate(userAgent, MAX_STRING),
        certSha256: cert,
        sessionBuild: auth && auth.build ? num(auth.build) : null,
        action: truncate(field(raw, "action"), MAX_STRING),
        level: ALLOWED_LEVELS.has(level) ? level : "info",
        error: truncate(field(raw, "error"), MAX_ERROR),
        durationMs: num(field(raw, "durationMs")),
        statusCode: num(field(raw, "statusCode")),
        meta: sanitiseMeta(field(raw, "meta")),
        expiresAt: new Date(Date.now() + RETENTION_DAYS * 86400000),
      });
    }

    if (docs.length === 0) return { accepted: 0, rejected: events.length };

    // Never let telemetry take the API down: a write failure is logged and
    // swallowed, and the client is still told the batch was accepted.
    try {
      await DevLog.insertMany(docs, { ordered: false });
    } catch (error) {
      console.error("[devlog] insert failed:", error.message);
    }

    return {
      accepted: docs.length,
      rejected: events.length - docs.length,
    };
  }

  /**
   * Debug query used from the server shell / a future admin endpoint.
   * Deliberately simple: this is a developer tool, not a public API.
   */
  async query({ event, level, installId, userId, appBuild, since, limit }) {
    const q = {};
    if (event) q.event = event;
    if (level) q.level = level;
    if (installId) q.installId = installId;
    if (userId) q.userId = String(userId);
    if (appBuild) q.appBuild = Number(appBuild);
    if (since) q.createdAt = { $gte: new Date(since) };

    return DevLog.find(q)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 50, 200))
      .lean();
  }
}

module.exports = { DevLogService, RETENTION_DAYS };