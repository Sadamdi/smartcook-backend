"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { parseReleaseManifest, APK_ABIS } = require("./schema");

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

  getClientBuild(req) {
    const raw = req.headers["x-smartcook-build"] || req.query.build;
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }

  getClientCert(req) {
    return (req.headers["x-smartcook-cert"] || "").trim();
  }

  async getVersion(req) {
    const m = await this.readManifest();
    const cert = this.getClientCert(req);
    const client = {
      build: this.getClientBuild(req),
      cert,
      isOfficial: this.isOfficialCert(cert),
    };

    if (client.cert && !client.isOfficial) {
      // Cert was sent but doesn't match the release cert: refuse the
      // token entirely so the client knows it's not the official app.
      const e = new Error("Forbidden");
      e.statusCode = 403;
      e.code = "FORBIDDEN_CLIENT";
      throw e;
    }

    const mayDownload = client.isOfficial;
    const token = mayDownload ? createDownloadToken(m.build, Date.now()) : null;
    const mandatory =
      client.build !== undefined &&
      (client.build < m.minBuild || m.blockedBuilds.includes(client.build));

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
      latestApkSha256: m.apks[0]?.sha256 || null,
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