"use strict";

/**
 * Sealed-box envelope for developer-log batches.
 *
 *   client                                   server
 *   ------                                   ------
 *   eph  = X25519 keypair (new per batch)    holds the private key (.env only)
 *   ss   = X25519(eph.priv, server.pub)      ss = X25519(server.priv, eph.pub)
 *   key  = HKDF-SHA256(ss, salt=eph.pub, info="smartcook-devlog-v1|<kid>")
 *   ct   = AES-256-GCM(key, nonce, aad, JSON{t, events})
 *
 * The APK only ever holds the server's PUBLIC key, which can lock but never
 * unlock, so unpacking the app yields nothing that decrypts traffic. What this
 * does NOT give: authenticity. Anyone can encrypt to a public key, so a
 * modified client can still post bogus (but size-capped, allow-listed) events.
 *
 * Keys are versioned by `kid` (first 8 hex of sha256(public key)) so a key can
 * be rotated: set the new one as DEVLOG_PRIVATE_KEY and keep the old one in
 * DEVLOG_PRIVATE_KEY_PREV until old APKs have aged out.
 */

const crypto = require("crypto");

const VERSION = 1;
const INFO_PREFIX = "smartcook-devlog-v1|";
const MAX_CIPHERTEXT_BYTES = 256 * 1024;
const CLOCK_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const NONCE_CACHE_MAX = 5000;

const b64u = {
  enc: (buf) => Buffer.from(buf).toString("base64url"),
  dec: (s) => Buffer.from(String(s), "base64url"),
};

class EnvelopeError extends Error {
  constructor(reason) {
    super(`devlog envelope rejected: ${reason}`);
    this.reason = reason;
  }
}

function rawPublic(publicKeyObject) {
  return b64u.dec(publicKeyObject.export({ format: "jwk" }).x);
}

function keyId(publicKeyObject) {
  return crypto.createHash("sha256").update(rawPublic(publicKeyObject)).digest("hex").slice(0, 8);
}

function importPrivate(encoded) {
  const privateKey = crypto.createPrivateKey({
    key: b64u.dec(encoded),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey, kid: keyId(publicKey) };
}

/** Current key first, then the previous one (rotation window). */
function loadKeys(env = process.env) {
  const out = [];
  for (const name of ["DEVLOG_PRIVATE_KEY", "DEVLOG_PRIVATE_KEY_PREV"]) {
    const v = (env[name] || "").trim();
    if (!v) continue;
    try {
      out.push(importPrivate(v));
    } catch (e) {
      console.error(`[devlog] ${name} is not a valid X25519 PKCS8 key`);
    }
  }
  return out;
}

function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  return {
    privateKey: b64u.enc(privateKey.export({ format: "der", type: "pkcs8" })),
    publicKey: b64u.enc(rawPublic(publicKey)),
    kid: keyId(publicKey),
  };
}

const aadFor = (kid, k) => Buffer.from(`${INFO_PREFIX}${kid}|${k}`, "utf8");

// Replay guard: a captured batch cannot be resubmitted inside the time window.
const seenNonces = new Map();
function remember(nonce, now) {
  for (const [n, exp] of seenNonces) if (exp < now) seenNonces.delete(n);
  if (seenNonces.size >= NONCE_CACHE_MAX) {
    seenNonces.delete(seenNonces.keys().next().value);
  }
  if (seenNonces.has(nonce)) return false;
  seenNonces.set(nonce, now + CLOCK_TOLERANCE_MS * 2);
  return true;
}

/** Decrypts an envelope. Throws EnvelopeError (never leaks which check failed to the client). */
function open(envelope, keys, now = Date.now()) {
  if (!envelope || typeof envelope !== "object" || envelope.v !== VERSION) throw new EnvelopeError("version");
  const { kid, k, n, c } = envelope;
  if ([kid, k, n, c].some((x) => typeof x !== "string")) throw new EnvelopeError("shape");

  const key = keys.find((x) => x.kid === kid);
  if (!key) throw new EnvelopeError("unknown_kid");

  const eph = b64u.dec(k);
  const nonce = b64u.dec(n);
  const sealed = b64u.dec(c);
  if (eph.length !== 32 || nonce.length !== 12) throw new EnvelopeError("lengths");
  if (sealed.length < 17 || sealed.length > MAX_CIPHERTEXT_BYTES) throw new EnvelopeError("size");

  let plaintext;
  try {
    const peer = crypto.createPublicKey({
      key: { kty: "OKP", crv: "X25519", x: b64u.enc(eph) },
      format: "jwk",
    });
    const shared = crypto.diffieHellman({ privateKey: key.privateKey, publicKey: peer });
    const aesKey = Buffer.from(
      crypto.hkdfSync("sha256", shared, eph, Buffer.from(`${INFO_PREFIX}${kid}`, "utf8"), 32),
    );
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, nonce);
    decipher.setAAD(aadFor(kid, k));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    plaintext = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  } catch {
    throw new EnvelopeError("decrypt"); // wrong key, tampered, or wrong AAD
  }

  let body;
  try {
    body = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new EnvelopeError("json");
  }
  if (!body || typeof body.t !== "number" || Math.abs(now - body.t) > CLOCK_TOLERANCE_MS) {
    throw new EnvelopeError("stale");
  }
  if (!remember(n, now)) throw new EnvelopeError("replay");
  return body;
}

/** Server-side `seal`, used by tests and tooling; the app does the same in Dart. */
function seal(body, publicKeyB64u, kidOverride) {
  const serverPub = crypto.createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: publicKeyB64u },
    format: "jwk",
  });
  const kid = kidOverride || keyId(serverPub);
  const eph = crypto.generateKeyPairSync("x25519");
  const ephRaw = rawPublic(eph.publicKey);
  const k = b64u.enc(ephRaw);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: serverPub });
  const aesKey = Buffer.from(
    crypto.hkdfSync("sha256", shared, ephRaw, Buffer.from(`${INFO_PREFIX}${kid}`, "utf8"), 32),
  );
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, nonce);
  cipher.setAAD(aadFor(kid, k));
  const ct = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { v: VERSION, kid, k, n: b64u.enc(nonce), c: b64u.enc(ct) };
}

module.exports = { open, seal, loadKeys, generateKeyPair, EnvelopeError, VERSION, CLOCK_TOLERANCE_MS, _resetNonces: () => seenNonces.clear() };
