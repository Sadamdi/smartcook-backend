"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { parseReleaseManifest, APK_ABIS } = require("./schema");
const { logEvent } = require("../../utils/logger");

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function forbiddenClient() {
  const e = new Error("Forbidden");
  e.statusCode = 403;
  e.code = "FORBIDDEN";
  return e;
}

function tokenExpired() {
  const e = new Error("Token expired");
  e.statusCode = 410;
  e.code = "TOKEN_EXPIRED";
  return e;
}

function notFound(message) {
  const e = new Error(message);
  e.statusCode = 404;
  e.code = "NOT_FOUND";
  return e;
}

function getKey() {
  return process.env.APP_DOWNLOAD_TOKEN_SECRET || "";
}

function getCert() {
  return (process.env.APP_RELEASE_CERT_SHA256 || "").toLowerCase().replace(/[^a-f0-9]/g, "");
}

function getReleasesDir() {
  return process.env.APP_RELEASES_DIR || "";
}

function getManifestPath() {
  const dir = getReleasesDir();
  if (!dir) return "";
  return path.join(dir, "latest.json");
}

function signPayload(payload) {
  return crypto.createHmac("sha256", getKey()).update(payload).digest("base64url");
}

function createDownloadToken(build, nowMs) {
  const payload = Buffer.from(
    JSON.stringify({ b: build, x: nowMs + TOKEN_TTL_MS })
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

function verifyDownloadToken(token) {
  const parts = (token || "").split(".");
  if (parts.length !== 2) throw forbiddenClient();
  const [payload, mac] = parts;
  if (!payload || !mac) throw forbiddenClient();

  const expected = signPayload(payload);
  if (
    mac.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  ) {
    throw forbiddenClient();
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw forbiddenClient();
  }
  if (!data || typeof data !== "object") throw forbiddenClient();
  if (typeof data.b !== "number" || typeof data.x !== "number") {
    throw forbiddenClient();
  }
  if (data.x < Date.now()) throw tokenExpired();
  return data.b;
}

class AppService {
  async readManifest() {
    const manifestPath = getManifestPath();
    if (!manifestPath) throw notFound("APP_RELEASES_DIR not configured");
    let raw;
    try {
      raw = await fs.promises.readFile(manifestPath, "utf8");
    } catch {
      throw notFound("No app release published yet");
    }
    return parseReleaseManifest(raw);
  }

  isOfficialCert(cert) {
    const expected = getCert();
    if (!expected) return false;
    const normalized = (cert || "").toLowerCase().replace(/[^a-f0-9]/g, "");
    return normalized.length > 0 && normalized === expected;
  }

  /**
 * Reads the installed build number from the request.
 *
 * `latest.json.build` is the `+N` suffix from pubspec.yaml (7 for 1.0.6), and
 * that is what the client must send. Gradle also derives an Android
 * `versionCode` from the dotted version name (1.0.6 became 2006), which is an
 * unrelated numbering: if a client sends that, `clientBuild < minBuild` is
 * never true and `mandatory` is permanently false, so nobody ever gets the
 * update dialog. Treat a value far outside the manifest's own range as
 * unusable rather than silently believing it.
 */
getClientBuild(req, manifestBuild) {
    const raw = req.headers["x-smartcook-build"] || req.query.build;
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) return undefined;
    // Builds grow by small steps; a client claiming to be thousands ahead of
    // the published build is reporting a different numbering scheme.
    if (Number.isInteger(manifestBuild) && n > manifestBuild * 100) {
      logEvent("app_version_check", {
        ip: req.headers["x-forwarded-for"] || req.ip,
        userAgent: req.headers["user-agent"],
        clientBuild: n,
        latestBuild: manifestBuild,
        success: false,
        statusCode: 200,
        reason: "implausible_build_number",
      });
      return undefined;
    }
    return n;
  }

  getClientCert(req) {
    return (req.headers["x-smartcook-cert"] || "").trim();
  }

  async getVersion(req) {
    const m = await this.readManifest();
    const cert = this.getClientCert(req);
    const client = {
      build: this.getClientBuild(req, m.build),
      cert,
      isOfficial: this.isOfficialCert(cert),
    };

    if (client.cert && !client.isOfficial) {
      // Cert was sent but doesn't match the release cert: refuse the
      // token entirely so the client knows it's not the official app.
      const e = new Error("Forbidden");
      e.statusCode = 403;
      e.code = "FORBIDDEN_CLIENT";
      logEvent("app_version_check", {
        ip: req.headers["x-forwarded-for"] || req.ip,
        userAgent: req.headers["user-agent"],
        clientBuild: client.build,
        success: false,
        statusCode: 403,
        reason: "cert_mismatch",
      });
      throw e;
    }

    const mayDownload = client.isOfficial;
    const token = mayDownload ? createDownloadToken(m.build, Date.now()) : null;
    const mandatory =
      client.build !== undefined &&
      (client.build < m.minBuild || m.blockedBuilds.includes(client.build));

    // Log every check. Without this there is no way to tell "the client never
    // asked" apart from "the client asked and decided not to show a dialog".
    logEvent("app_version_check", {
      ip: req.headers["x-forwarded-for"] || req.ip,
      userAgent: req.headers["user-agent"],
      clientBuild: client.build,
      latestBuild: m.build,
      minBuild: m.minBuild,
      mandatory,
      isOfficial: client.isOfficial,
      hasToken: Boolean(token),
      success: true,
      statusCode: 200,
    });

    return {
      latestVersion: m.version,
      latestBuild: m.build,
      minBuild: m.minBuild,
      blockedBuilds: m.blockedBuilds,
      releaseType: m.releaseType,
      notes: m.notes,
      date: m.date,
      abis: APK_ABIS,
      token,
      // `mandatory` tells the client this is a forced update.
      mandatory,
      // `downloadPath` is path-only (no host) so the client can append
      // `?abi=...` etc. on its own. Cert gate is enforced via the token.
      downloadPath: "/api/app/download",
      // Per-ABI SHA-256, so an arm64 device verifies the arm64 APK and never
      // the arm32 one. Same field name the Kelilink client reads.
      apkSha256: Object.fromEntries(
        m.apks.map((a) => [a.abi, a.sha256]),
      ),
      // Full release history so the in-app changelog can show every version,
      // newest first. Same shape the auto-update dialog already parses.
      history: m.history,
    };
  }

  async resolveApk({ abi, token }) {
    const m = await this.readManifest();
    const build = verifyDownloadToken(token);
    if (build !== m.build) {
      throw forbiddenClient();
    }
    if (!abi) abi = m.apks[0]?.abi;
    const entry = m.apks.find((a) => a.abi === abi) || m.apks[0];
    if (!entry) throw notFound("No APK available for this build");

    const dir = getReleasesDir();
    const filePath = path.join(dir, entry.file);
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      throw notFound("APK file missing on server");
    }
    return {
      filePath,
      fileName: `SmartCook-${m.version}-${entry.abi}.apk`,
      sha256: entry.sha256,
    };
  }
}

module.exports = {
  AppService,
  createDownloadToken,
  verifyDownloadToken,
  TOKEN_TTL_MS,
};