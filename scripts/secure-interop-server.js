#!/usr/bin/env node
"use strict";
// Test harness for the Flutter client: a REAL Express stack (compression, json
// parser, the secure-channel middleware) with a handful of routes, listening on
// a random loopback port. No database. Used by
// smartcook-frontend/test/secure_channel_interop_test.dart.
//
//   INTEROP_API_PRIVATE_KEY=<pkcs8 b64url> [INTEROP_STRICT=1] node scripts/secure-interop-server.js
//   prints one JSON line: {"port":12345}
const express = require("express");
const compression = require("compression");
const secure = require("../src/modules/secure/channel");

const keys = secure.loadKeys({ API_PRIVATE_KEY: process.env.INTEROP_API_PRIVATE_KEY });
if (keys.length === 0) {
  console.error("INTEROP_API_PRIVATE_KEY missing or invalid");
  process.exit(2);
}
const strict = process.env.INTEROP_STRICT === "1";

const app = express();
app.use(compression({ threshold: 0 }));
app.use(express.json({ limit: "1mb" }));
app.use(secure.middleware({ getKeys: () => keys, requireEncrypted: () => strict }));

app.get("/api/echo", (req, res) =>
  res.json({
    query: req.query,
    auth: req.headers.authorization || null,
    userToken: req.headers["x-user-token"] || null,
    cert: req.headers["x-smartcook-cert"] || null,
    build: req.headers["x-smartcook-build"] || null,
  }),
);
app.post("/api/echo", (req, res) =>
  res.status(201).json({ body: req.body, auth: req.headers.authorization || null, cert: req.headers["x-smartcook-cert"] || null }),
);
app.delete("/api/echo", (req, res) => res.json({ deleted: true, body: req.body, auth: req.headers.authorization || null }));
app.get("/api/denied", (req, res) => res.status(403).json({ success: false, code: "FORBIDDEN_X", message: "tidak boleh" }));
app.get("/api/limited", (req, res) => res.status(429).set("Retry-After", "7").json({ success: false, message: "pelan-pelan" }));
app.get("/api/boom", (req, res) => res.status(500).json({ success: false, message: "rusak" }));
app.get("/api/empty", (req, res) => res.status(204).end());
app.get("/api/unicode", (req, res) => res.json({ teks: "Ayam goreng çödé ✓ 🍛" }));
app.get("/api/big", (req, res) => res.json({ rows: Array.from({ length: 5000 }, (_, i) => ({ i, nama: "resep-" + i })) }));
app.post("/api/chat/message-stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ status: "connected" })}\n\n`);
  for (const text of ["Halo ", "dunia", "!"]) {
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
    if (typeof res.flush === "function") res.flush();
    await new Promise((r) => setTimeout(r, 5));
  }
  res.write(`data: ${JSON.stringify({ done: true, fullReply: "Halo dunia! " + (req.body.message || "") })}\n\n`);
  res.end();
});
app.get("/api/app/version", (req, res) => res.json({ success: true, data: { latestBuild: 99 } }));
app.get("/api/health", (req, res) => res.json({ success: true }));
app.use((err, req, res, next) => res.status(500).json({ success: false, message: err.message }));

const server = app.listen(0, "127.0.0.1", () => {
  console.log(JSON.stringify({ port: server.address().port }));
});
