"use strict";

const mongoose = require("mongoose");

/**
 * One row per issued app session (one handshake, one device).
 *
 * Only hashes are stored. `refreshJti` ties an access token to its refresh
 * partner so rotation can revoke the old pair atomically.
 */
const AppTokenSchema = new mongoose.Schema(
  {
    jti: { type: String, required: true, unique: true, index: true },
    refreshJti: { type: String, required: true, index: true },

    // SHA-256 of the opaque access token. Unique so a lookup is a point read.
    accessHash: { type: String, required: true, unique: true, index: true },
    // SHA-256 of the opaque refresh token.
    refreshHash: { type: String, required: true, index: true },

    // Which signing key generation issued this pair (for rotation audits).
    keyIndex: { type: Number, required: true, default: 1, index: true },

    // Client fingerprint captured at handshake, for auditing only.
    certSha256: { type: String, required: true },
    build: { type: Number, required: true, index: true },
    abi: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },

    expiresAt: { type: Date, required: true },
    refreshExpiresAt: { type: Date, required: true },

    revoked: { type: Boolean, default: false, index: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },

    // Counts rotations of this session's tokens.
    rotations: { type: Number, default: 0 },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "apptokens", versionKey: false }
);

// Serve-side lookups: "give me the live session for this access token".
AppTokenSchema.index({ accessHash: 1, revoked: 1 });
// Housekeeping: sweep expired rows in bulk.
AppTokenSchema.index({ expiresAt: 1 });
AppTokenSchema.index({ refreshExpiresAt: 1 });

module.exports =
  mongoose.models.AppToken || mongoose.model("AppToken", AppTokenSchema);
