#!/usr/bin/env node
"use strict";
// HTTP-level test of POST /ingest with the real controller. The storage layer
// is stubbed, so no database is touched.
//   node scripts/test-devlog-ingest.js
const assert = require("assert");
const http = require("http");
const express = require("express");

const crypto = require("../src/modules/devlog/crypto");
const kp = crypto.generateKeyPair();
process.env.DEVLOG_PRIVATE_KEY = kp.privateKey;

const { DevLogService } = require("../src/modules/devlog/service");
const stored = [];
DevLogService.prototype.ingest = async function (req, events) {
  stored.push(...(events || []));
  return { accepted: (events || []).length, rejected: 0 };
};
const controller = require("../src/modules/devlog/controller");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.post("/ingest", controller.ingest);

const post = (port, body) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request(
      { port, path: "/ingest", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let out = "";
        res.on("data", (d) => (out += d));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(out) }));
      },
    );
    r.on("error", reject);
    r.end(data);
  });

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  const quiet = console.warn;
  console.warn = () => {};
  const ev = [{ e: "app_launch", a: "cold_start" }];
  let n = 0;
  const check = (name, cond) => {
    assert.ok(cond, name);
    n++;
    console.log("  ok  " + name);
  };

  let r = await post(port, crypto.seal({ t: Date.now(), events: ev }, kp.publicKey));
  check("encrypted batch is accepted and decrypted", r.status === 200 && r.body.data.accepted === 1 && stored.length === 1 && stored[0].e === "app_launch");

  const sealed = crypto.seal({ t: Date.now(), events: ev }, kp.publicKey);
  await post(port, sealed);
  r = await post(port, sealed);
  check("replayed batch is refused with a generic 400", r.status === 400 && r.body.message === "Invalid payload.");

  r = await post(port, { ...crypto.seal({ t: Date.now(), events: ev }, kp.publicKey), c: "AAAA" });
  check("tampered batch is refused", r.status === 400);

  const before = stored.length;
  r = await post(port, crypto.seal({ t: Date.now(), events: ev }, crypto.generateKeyPair().publicKey));
  check("batch sealed to some other key stores nothing", r.status === 400 && stored.length === before);

  r = await post(port, { events: ev });
  check("legacy plaintext batch still works during the transition", r.status === 200 && r.body.data.accepted === 1);

  process.env.DEVLOG_REQUIRE_ENCRYPTED = "1";
  r = await post(port, { events: ev });
  check("plaintext is refused once DEVLOG_REQUIRE_ENCRYPTED=1", r.status === 400 && r.body.message === "Invalid payload.");
  r = await post(port, crypto.seal({ t: Date.now(), events: ev }, kp.publicKey));
  check("encrypted still works in strict mode", r.status === 200);

  console.warn = quiet;
  server.close();
  console.log(`\n${n} ingest tests passed`);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
