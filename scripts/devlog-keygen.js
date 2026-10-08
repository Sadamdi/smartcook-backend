#!/usr/bin/env node
"use strict";
/**
 * Generates an X25519 key pair for developer-log encryption.
 *
 *   node scripts/devlog-keygen.js            # prints private + public + kid
 *   node scripts/devlog-keygen.js --env      # prints only the .env line
 *
 * Run it ON THE SERVER. The private key never needs to exist anywhere else;
 * only the public key (and kid) go into the app.
 */
const { generateKeyPair } = require("../src/modules/devlog/crypto");

const k = generateKeyPair();
if (process.argv.includes("--env")) {
  console.log(`DEVLOG_PRIVATE_KEY=${k.privateKey}`);
} else {
  console.log(`DEVLOG_PRIVATE_KEY=${k.privateKey}   # server .env only, chmod 600, never commit`);
  console.log(`PUBLIC_KEY=${k.publicKey}   # goes into the app`);
  console.log(`KID=${k.kid}`);
}
