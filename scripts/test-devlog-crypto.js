#!/usr/bin/env node
"use strict";
// Behavioural tests for the developer-log envelope. No database, no network.
//   node scripts/test-devlog-crypto.js
const assert = require("assert");
const env = require("../src/modules/devlog/crypto");

const kp = env.generateKeyPair();
const keys = env.loadKeys({ DEVLOG_PRIVATE_KEY: kp.privateKey });
assert.strictEqual(keys.length, 1);
assert.strictEqual(keys[0].kid, kp.kid);

const body = () => ({ t: Date.now(), events: [{ e: "app_launch", note: "rahasia sultan@gmail.com" }] });
let passed = 0;
const t = (name, fn) => {
  env._resetNonces();
  fn();
  passed++;
  console.log("  ok  " + name);
};
const rejects = (e, reason, k = keys) =>
  assert.throws(
    () => env.open(e, k),
    (x) => x instanceof env.EnvelopeError && x.reason === reason,
    `expected rejection "${reason}"`,
  );

t("round trip", () => {
  assert.deepStrictEqual(env.open(env.seal(body(), kp.publicKey), keys).events, body().events);
});

t("ciphertext hides the plaintext", () => {
  const raw = JSON.stringify(env.seal(body(), kp.publicKey));
  assert.ok(!raw.includes("rahasia") && !raw.includes("gmail") && !raw.includes("app_launch"));
});

t("every batch uses a fresh ephemeral key and nonce", () => {
  const a = env.seal(body(), kp.publicKey);
  const b = env.seal(body(), kp.publicKey);
  assert.notStrictEqual(a.k, b.k);
  assert.notStrictEqual(a.n, b.n);
  assert.notStrictEqual(a.c, b.c);
});

t("flipping any bit of the ciphertext is rejected", () => {
  const e = env.seal(body(), kp.publicKey);
  const raw = Buffer.from(e.c, "base64url");
  for (let i = 0; i < raw.length; i += Math.max(1, raw.length >> 4)) {
    const bad = Buffer.from(raw);
    bad[i] ^= 1;
    env._resetNonces();
    rejects({ ...e, c: bad.toString("base64url") }, "decrypt");
  }
});

t("tampered ephemeral key is rejected", () => {
  const e = env.seal(body(), kp.publicKey);
  rejects({ ...e, k: env.generateKeyPair().publicKey }, "decrypt");
});

t("nonce swap is rejected", () => {
  const e = env.seal(body(), kp.publicKey);
  const other = env.seal(body(), kp.publicKey);
  rejects({ ...e, n: other.n }, "decrypt");
});

t("kid is bound into the AAD", () => {
  const e = env.seal(body(), kp.publicKey);
  const second = env.generateKeyPair();
  const both = env.loadKeys({
    DEVLOG_PRIVATE_KEY: kp.privateKey,
    DEVLOG_PRIVATE_KEY_PREV: second.privateKey,
  });
  rejects({ ...e, kid: second.kid }, "decrypt", both);
});

t("a server key that is not the intended recipient cannot open it", () => {
  const stranger = env.loadKeys({ DEVLOG_PRIVATE_KEY: env.generateKeyPair().privateKey });
  rejects(env.seal(body(), kp.publicKey), "unknown_kid", stranger);
  rejects(env.seal(body(), kp.publicKey, stranger[0].kid), "decrypt", stranger);
});

t("replay of the same batch is rejected", () => {
  const e = env.seal(body(), kp.publicKey);
  env.open(e, keys);
  rejects(e, "replay");
});

t("stale and future-dated batches are rejected", () => {
  rejects(env.seal({ t: Date.now() - 2 * 864e5, events: [] }, kp.publicKey), "stale");
  env._resetNonces();
  rejects(env.seal({ t: Date.now() + 2 * 864e5, events: [] }, kp.publicKey), "stale");
});

t("malformed envelopes only ever raise EnvelopeError", () => {
  const bads = [
    null,
    undefined,
    5,
    "x",
    [],
    {},
    { v: 2 },
    { v: 1 },
    { v: 1, kid: 1, k: 2, n: 3, c: 4 },
    { v: 1, kid: kp.kid, k: "AA", n: "AA", c: "AA" },
    { v: 1, kid: kp.kid, k: "A".repeat(43), n: "A".repeat(16), c: "A".repeat(10) },
  ];
  for (const bad of bads) {
    assert.throws(() => env.open(bad, keys), (x) => x instanceof env.EnvelopeError);
  }
});

t("oversized ciphertext is rejected before any crypto runs", () => {
  const e = env.seal(body(), kp.publicKey);
  rejects({ ...e, c: Buffer.alloc(300 * 1024).toString("base64url") }, "size");
});

t("key rotation: the previous key still opens traffic from old apps", () => {
  const next = env.generateKeyPair();
  const both = env.loadKeys({
    DEVLOG_PRIVATE_KEY: next.privateKey,
    DEVLOG_PRIVATE_KEY_PREV: kp.privateKey,
  });
  assert.strictEqual(both.length, 2);
  assert.strictEqual(env.open(env.seal(body(), kp.publicKey), both).events.length, 1);
  env._resetNonces();
  assert.strictEqual(env.open(env.seal(body(), next.publicKey), both).events.length, 1);
});

t("garbage key material in the environment is ignored, not fatal", () => {
  const silence = console.error;
  console.error = () => {};
  const loaded = env.loadKeys({ DEVLOG_PRIVATE_KEY: "not-a-key" });
  console.error = silence;
  assert.deepStrictEqual(loaded, []);
});

console.log(`\n${passed} envelope tests passed`);
