"use strict";

// Same as Kelilink src/modules/app/schema.ts but in CommonJS / manual validation.
// We don't pull in zod just for this; the manifest is small.

const APK_FILENAME = /^[\w.+-]+\.apk$/;
const SHA256 = /^[a-f0-9]{64}$/;
const APK_ABIS = ["arm64", "arm32"];

const RELEASE_TYPES = ["patch", "minor", "big", "major", "rollback"];

function ensureString(value, field, { min = 1, max } = {}) {
  if (typeof value !== "string" || value.length < min) {
    throw badManifest(`${field} required`);
  }
  if (max && value.length > max) throw badManifest(`${field} too long`);
  return value;
}

function ensureInt(value, field, { min = 1 } = {}) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw badManifest(`${field} must be an integer >= ${min}`);
  }
  return n;
}

function ensureApkAbi(value, field) {
  if (value !== "arm64" && value !== "arm32") {
    throw badManifest(`${field} must be arm64 or arm32`);
  }
  return value;
}

function badManifest(err) {
  const e = new Error("Invalid latest.json: " + err);
  e.statusCode = 500;
  return e;
}

function parseReleaseManifest(raw) {
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    throw badManifest("not valid JSON");
  }
  if (!data || typeof data !== "object") throw badManifest("not an object");

  const version = ensureString(data.version, "version", { min: 1 });
  const build = ensureInt(data.build, "build", { min: 1 });
  const minBuild = ensureInt(data.minBuild, "minBuild", { min: 1 });
  const blockedBuilds = Array.isArray(data.blockedBuilds)
    ? data.blockedBuilds.map((b, i) => ensureInt(b, `blockedBuilds[${i}]`, { min: 1 }))
    : [];

  if (!RELEASE_TYPES.includes(data.releaseType)) {
    throw badManifest("releaseType must be one of " + RELEASE_TYPES.join("/"));
  }
  const releaseType = data.releaseType;

  if (!Array.isArray(data.apks) || data.apks.length === 0) {
    throw badManifest("apks must be a non-empty array");
  }

  const apks = data.apks.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw badManifest(`apks[${i}] not an object`);
    }
    const abi = ensureApkAbi(entry.abi, `apks[${i}].abi`);
    const file = ensureString(entry.file, `apks[${i}].file`, { max: 128 });
    if (!APK_FILENAME.test(file)) throw badManifest(`apks[${i}].file not a plain filename`);
    const sha256 = ensureString(entry.sha256, `apks[${i}].sha256`, { min: 64, max: 64 });
    if (!SHA256.test(sha256)) throw badManifest(`apks[${i}].sha256 must be 64 lowercase hex`);
    const sizeBytes = entry.sizeBytes !== undefined ? Number(entry.sizeBytes) : null;
    if (sizeBytes !== null && (!Number.isFinite(sizeBytes) || sizeBytes <= 0)) {
      throw badManifest(`apks[${i}].sizeBytes must be positive`);
    }
    return { abi, file, sha256, sizeBytes };
  });

  const notes = ensureString(data.notes, "notes", { min: 1 });
  const date =
    typeof data.date === "string" ? data.date : new Date().toISOString().slice(0, 10);

  return {
    version,
    build,
    minBuild,
    blockedBuilds,
    releaseType,
    notes,
    date,
    apks,
  };
}

module.exports = {
  APK_ABIS,
  RELEASE_TYPES,
  parseReleaseManifest,
};