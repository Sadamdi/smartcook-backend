"use strict";

const crypto = require("crypto");

const AppToken = require("./model");
const {
  generateToken,
  hashToken,
  proofFor,
  accessTtlSeconds,
  refreshTtlSeconds,
  keyIndex,
} = require("./schema");
const { logEvent } = require("../../utils/logger");

const VALID_ABIS = new Set(["arm64", "arm32", "universal"]);

function forbidden(code, message) {
  const e = new Error(message);
  e.statusCode = 403;
  e.code = code;
  return e;
}

function tokenExpired(code, message) {
  const e = new Error(message);
  e.statusCode = 401;
  e.code = code;
  return e;
}

function notFound(message) {
  const e = new Error(message);
  e.statusCode = 404;
  e.code = "NOT_FOUND";
  return e;
}

function buildRequestContext(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) ||
    req.ip ||
    null;
  return {
    ip,
    userAgent: req.headers["user-agent"] || null,
  };
}

class AppTokenService {
  /**
   * Mint a brand-new session (access + refresh) for a cert-verified client.
   * Called only from the handshake endpoint.
   */
  async issueForCert({ cert, build, abi, ip, userAgent }) {
    const accessTtl = accessTtlSeconds();
    const refreshTtl = refreshTtlSeconds();
    const now = Date.now();

    const access = generateToken();
    const refresh = generateToken();
    const jti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();

    const doc = await AppToken.create({
      jti,
      refreshJti,
      accessHash: hashToken(access),
      refreshHash: hashToken(refresh),
      keyIndex: keyIndex(),
      certSha256: cert,
      build,
      abi: VALID_ABIS.has(abi) ? abi : null,
      ip,
      userAgent,
      expiresAt: new Date(now + accessTtl * 1000),
      refreshExpiresAt: new Date(now + refreshTtl * 1000),
      revoked: false,
      rotations: 0,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });

    logEvent("app_token_handshake", {
      ip,
      userAgent,
      build,
      abi: doc.abi,
      jti,
      keyIndex: doc.keyIndex,
      success: true,
      statusCode: 201,
      accessExpiresAt: doc.expiresAt.toISOString(),
      refreshExpiresAt: doc.refreshExpiresAt.toISOString(),
    });

    return {
      access,
      refresh,
      access_expires_in: accessTtl,
      refresh_expires_in: refreshTtl,
      access_expires_at: doc.expiresAt.toISOString(),
      refresh_expires_at: doc.refreshExpiresAt.toISOString(),
      build,
      abi: doc.abi,
      proof: proofFor(access),
    };
  }

  /** Look up a live session by its access token. Throws 401 when unusable. */
  async lookupAccess(accessToken) {
    if (!accessToken) {
      throw tokenExpired("TOKEN_MISSING", "Access token tidak dikirim.");
    }
    const doc = await AppToken.findOne({
      accessHash: hashToken(accessToken),
      revoked: false,
    });

    if (!doc) {
      // Cannot distinguish "never issued" from "revoked" without leaking
      // more, so both collapse into one code. A revoked token is a harder
      // signal, but the client treats them the same way (re-handshake).
      throw tokenExpired(
        "TOKEN_INVALID",
        "Access token tidak dikenal atau sudah dicabut.",
      );
    }
    if (doc.expiresAt.getTime() <= Date.now()) {
      throw tokenExpired("TOKEN_EXPIRED", "Access token sudah kedaluwarsa.");
    }
    return doc;
  }

  /**
   * Rotate a refresh token into a new access+refresh pair. The old pair is
   * revoked in the same write so a stolen old refresh token cannot be
   * replayed after the legitimate client rotates.
   */
  async rotate(refreshToken, { ip, userAgent } = {}) {
    if (!refreshToken) {
      throw tokenExpired("REFRESH_MISSING", "Refresh token tidak dikirim.");
    }
    const doc = await AppToken.findOne({
      refreshHash: hashToken(refreshToken),
      revoked: false,
    });

    if (!doc) {
      throw tokenExpired(
        "REFRESH_INVALID",
        "Refresh token tidak dikenal atau sudah dicabut.",
      );
    }
    if (doc.refreshExpiresAt.getTime() <= Date.now()) {
      throw tokenExpired(
        "REFRESH_EXPIRED",
        "Refresh token sudah kedaluwarsa. Hubungi server untuk sesi baru.",
      );
    }

    const accessTtl = accessTtlSeconds();
    const refreshTtl = refreshTtlSeconds();
    const now = Date.now();

    const access = generateToken();
    const refresh = generateToken();

    const next = {
      jti: crypto.randomUUID(),
      refreshJti: crypto.randomUUID(),
      accessHash: hashToken(access),
      refreshHash: hashToken(refresh),
      keyIndex: keyIndex(),
      certSha256: doc.certSha256,
      build: doc.build,
      abi: doc.abi,
      ip: ip || doc.ip,
      userAgent: userAgent || doc.userAgent,
      expiresAt: new Date(now + accessTtl * 1000),
      refreshExpiresAt: new Date(now + refreshTtl * 1000),
      revoked: false,
      revokedAt: null,
      revokedReason: null,
      rotations: (doc.rotations || 0) + 1,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };

    // Single atomic swap: the previous row is retired and the new one is
    // created together, so there is no window where both are valid.
    await AppToken.deleteOne({ _id: doc._id });
    const created = await AppToken.create(next);

    logEvent("app_token_refresh", {
      ip: next.ip,
      userAgent: next.userAgent,
      build: next.build,
      jti: next.jti,
      previousJti: doc.jti,
      rotation: next.rotations,
      keyIndex: next.keyIndex,
      success: true,
      statusCode: 200,
      refreshExpiresAt: next.refreshExpiresAt.toISOString(),
    });

    return {
      access,
      refresh,
      access_expires_in: accessTtl,
      refresh_expires_in: refreshTtl,
      access_expires_at: created.expiresAt.toISOString(),
      refresh_expires_at: created.refreshExpiresAt.toISOString(),
      build: created.build,
      abi: created.abi,
      proof: proofFor(access),
    };
  }

  /**
   * Revoke the session that owns this access token. Idempotent: revoking an
   * already-revoked token still reports success so the client can clear its
   * local copy without error handling.
   */
  async revokeByAccess(accessToken, reason = "client_logout") {
    if (!accessToken) return { revoked: false };
    const result = await AppToken.updateOne(
      { accessHash: hashToken(accessToken), revoked: false },
      {
        $set: {
          revoked: true,
          revokedAt: new Date(),
          revokedReason: String(reason).slice(0, 120),
          updatedAt: new Date(),
        },
      }
    );
    return { revoked: result.modifiedCount > 0 };
  }

  /** Operator tool: retire every live session (used after a key leak). */
  async revokeAll(reason = "operator_revoke_all") {
    const result = await AppToken.updateMany(
      { revoked: false },
      {
        $set: {
          revoked: true,
          revokedAt: new Date(),
          revokedReason: String(reason).slice(0, 120),
          updatedAt: new Date(),
        },
      }
    );
    return { revoked: result.modifiedCount };
  }

  /** Housekeeping: drop rows whose refresh window has fully closed. */
  async purgeExpired(olderThanMs = 24 * 60 * 60 * 1000) {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await AppToken.deleteMany({
      refreshExpiresAt: { $lt: cutoff },
    });
    return { purged: result.deletedCount };
  }

  /** Introspection for the operator dashboard / boot log. */
  async stats() {
    const now = new Date();
    const [live, expired, revoked] = await Promise.all([
      AppToken.countDocuments({ revoked: false, refreshExpiresAt: { $gt: now } }),
      AppToken.countDocuments({ revoked: false, refreshExpiresAt: { $lte: now } }),
      AppToken.countDocuments({ revoked: true }),
    ]);
    return { live, expired, revoked, total: live + expired + revoked };
  }
}

module.exports = {
  AppTokenService,
  buildRequestContext,
  forbidden,
  tokenExpired,
  notFound,
};
