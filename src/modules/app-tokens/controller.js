"use strict";

const { AppTokenService, buildRequestContext } = require("./service");
// The auto-update module owns the canonical cert comparison, so the
// handshake gate can never drift from the gate that serves APKs.
const { AppService: ManifestService } = require("../app/service");

const manifestService = new ManifestService();
const tokenService = new AppTokenService();

/**
 * POST /api/auth/handshake
 *
 * The only unauthenticated way to obtain a token pair. Proof of being the
 * official app is the SHA-256 of the APK signing certificate, read at
 * runtime by `MainActivity.signingCertSha256()` and compared against
 * `APP_RELEASE_CERT_SHA256`. A repackaged or cloned APK reports a different
 * certificate and is rejected here.
 */
async function handshake(req, res, next) {
  try {
    const cert = (req.headers["x-smartcook-cert"] || "").trim();
    const { build: rawBuild, abi } = req.body || {};
    const build = Number(rawBuild);

    if (!cert) {
      return res.status(400).json({
        success: false,
        code: "CERT_MISSING",
        message: "Header X-Smartcook-Cert wajib diisi.",
      });
    }
    if (!Number.isInteger(build) || build <= 0) {
      return res.status(400).json({
        success: false,
        code: "BUILD_MISSING",
        message: "Field build wajib diisi (angka > 0).",
      });
    }

    if (!manifestService.isOfficialCert(cert)) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN_CLIENT",
        message: "Sertifikat aplikasi tidak dikenali sebagai rilis resmi.",
      });
    }

    const ctx = buildRequestContext(req);
    const tokens = await tokenService.issueForCert({
      cert: cert.toLowerCase(),
      build,
      abi,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    res.status(201).json({ success: true, data: tokens });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/refresh
 *
 * Exchanges a refresh token for a fresh pair. The previous pair is retired in
 * the same write, so a refresh token is strictly single-use.
 */
async function refresh(req, res, next) {
  try {
    const { refresh } = req.body || {};
    const ctx = buildRequestContext(req);
    const tokens = await tokenService.rotate(refresh, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    res.json({ success: true, data: tokens });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/auth/revoke
 *
 * Requires the access token being revoked, so a caller cannot kill someone
 * else's session. Idempotent by design.
 */
async function revoke(req, res, next) {
  try {
    const reason = (req.body && req.body.reason) || "client_logout";
    const result = await tokenService.revokeByAccess(
      req.appTokenValue,
      reason
    );
    res.json({
      success: true,
      data: { revoked: result.revoked },
      message: "Token dicabut.",
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { handshake, refresh, revoke };
