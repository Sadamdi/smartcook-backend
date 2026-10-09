"use strict";

const mongoose = require("mongoose");

const DAY = 24 * 60 * 60 * 1000;

const memberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    perms: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    addedBy: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: "ops_members" }
);

const restrictionSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["ip", "email"], required: true },
    value: { type: String, required: true, lowercase: true, trim: true },
    reason: { type: String, default: "", maxlength: 300 },
    by: { type: String, default: null },
    active: { type: Boolean, default: true },
    until: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: "ops_restrictions" }
);
restrictionSchema.index({ kind: 1, value: 1, active: 1 });

const trailSchema = new mongoose.Schema(
  {
    who: { type: String, required: true },
    action: { type: String, required: true },
    target: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
    at: { type: Date, default: Date.now },
    // Required, not defaulted: a TTL index ignores documents without the field.
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, collection: "ops_trail" }
);
trailSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
trailSchema.index({ at: -1 });

// One row per install: where it came from, who used it, when it was last seen.
// The full address lives here (and in `logins`) only, readable by members with
// the right, and goes away 30 days after the last sighting.
const seenSchema = new mongoose.Schema(
  {
    installId: { type: String, required: true, unique: true },
    userId: { type: String, default: null, index: true },
    deviceModel: { type: String, default: null },
    manufacturer: { type: String, default: null },
    osVersion: { type: String, default: null },
    sdkInt: { type: Number, default: null },
    appVersion: { type: String, default: null },
    appBuild: { type: Number, default: null },
    abi: { type: String, default: null },
    locale: { type: String, default: null },
    country: { type: String, default: null },
    timezone: { type: String, default: null },
    carrier: { type: String, default: null },
    ip: { type: String, default: null, index: true },
    userAgent: { type: String, default: null },
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now, index: true },
    lastEvent: { type: String, default: null },
    batches: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, collection: "ops_seen" }
);
seenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const loginSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    via: { type: String, default: null },
    at: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, collection: "ops_logins" }
);
loginSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

module.exports = {
  Member: model("OpsMember", memberSchema),
  Restriction: model("OpsRestriction", restrictionSchema),
  Trail: model("OpsTrail", trailSchema),
  Seen: model("OpsSeen", seenSchema),
  Login: model("OpsLogin", loginSchema),
  SEEN_DAYS: 30,
  TRAIL_DAYS: 180,
  DAY,
};
