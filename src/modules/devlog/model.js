"use strict";

const mongoose = require("mongoose");

/**
 * One row per client telemetry event.
 *
 * This is a DEBUG aid, not an audit trail: it exists so that when a user
 * reports "it went blank" we can see the device, the app build, the failing
 * action and the stack that produced it, without asking them to run anything.
 *
 * Rows expire on their own. `expiresAt` is indexed and a TTL index makes
 * MongoDB delete them; see schema.js for how far out that is set.
 */
const DevLogSchema = new mongoose.Schema({
  // Random per-install id. NOT tied to an account, so logs stay useful for
  // users who never log in. Rotated by the client on demand.
  installId: { type: String, default: null, index: true },

  // Coarse event name: "app_launch", "render_error", "locale_change", ...
  // Free-form payloads live in `meta` so new signal needs no migration.
  event: { type: String, required: true, index: true },

  // Set when the event happened while signed in, so logs can be joined to a
  // user. Both are the real values, not hashes: this is a debug log the
  // developer reads, and a hash would be useless for that job.
  userId: { type: String, default: null, index: true },
  userName: { type: String, default: null },
  userEmail: { type: String, default: null },

  // Device / app context, denormalised so a single query answers
  // "what was happening on that phone".
  appVersion: { type: String, default: null },
  appBuild: { type: Number, default: null, index: true },
  platform: { type: String, default: null },
  osVersion: { type: String, default: null },
  sdkInt: { type: Number, default: null },
  deviceModel: { type: String, default: null },
  deviceManufacturer: { type: String, default: null },
  abi: { type: String, default: null },
  locale: { type: String, default: null },

  // Network / server view of the same event.
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  certSha256: { type: String, default: null },
  // Build recorded by the server when the session was minted. Compared against
  // the client-reported appBuild: a mismatch means the app is lying about
  // which build it is, which is exactly the class of bug worth spotting.
  sessionBuild: { type: Number, default: null },

  // The action that was being attempted, e.g. "load_profile",
  // "switch_locale", "api:/api/recipes/popular".
  action: { type: String, default: null, index: true },

  // Outcome: "ok", "error", "blocked", ...
  level: { type: String, default: "info", index: true },

  // Free-form. `error` holds a truncated stack/message so a report like
  // "white screen after switching language" can be traced exactly.
  error: { type: String, default: null },
  durationMs: { type: Number, default: null },
  statusCode: { type: Number, default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Retention deadline. Required (not defaulted) because a TTL index silently
  // ignores documents without the field - they would sit in the collection
  // forever. The service sets it on every insert. Index declared once, below,
  // as a TTL index.
  expiresAt: { type: Date, required: true },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
});

/** TTL index: retention is enforced by the database, not by a cron job. */
DevLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Serves the "what happened in the last N hours" admin query.
DevLogSchema.index({ createdAt: -1 });
// Groups a single install's timeline.
DevLogSchema.index({ installId: 1, createdAt: -1 });
// Finds every error from one build - e.g. "did v1.0.10 break everyone?".
DevLogSchema.index({ appBuild: 1, level: 1, createdAt: -1 });

module.exports = mongoose.models.DevLog || mongoose.model("DevLog", DevLogSchema);