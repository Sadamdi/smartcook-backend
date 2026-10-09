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

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

module.exports = {
  Member: model("OpsMember", memberSchema),
  Restriction: model("OpsRestriction", restrictionSchema),
  Trail: model("OpsTrail", trailSchema),
  TRAIL_DAYS: 180,
  DAY,
};
