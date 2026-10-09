"use strict";

const mongoose = require("mongoose");
const { Restriction } = require("./models");
const { owners, record } = require("./access");
const r = require("./restrictions");

const bad = (res, message) => res.status(400).json({ success: false, message });

async function list(req, res) {
  const rows = await Restriction.find({ active: true }).sort({ createdAt: -1 }).limit(500).lean();
  res.json({
    success: true,
    data: rows.map((x) => ({ id: String(x._id), kind: x.kind, value: x.value, reason: x.reason, by: x.by, until: x.until, createdAt: x.createdAt })),
  });
}

/** One request may restrict an address, an e-mail or both. */
async function add(req, res) {
  const targets = [];
  const ip = req.body.ip ? String(req.body.ip).trim() : "";
  const email = req.body.email ? String(req.body.email).trim().toLowerCase() : "";
  if (ip) {
    if (!r.parseIpTarget(ip)) return bad(res, "Target tidak valid.");
    targets.push({ kind: "ip", value: r.normalizeIp(ip) });
  }
  if (email) {
    if (!r.EMAIL.test(email)) return bad(res, "Target tidak valid.");
    targets.push({ kind: "email", value: email });
  }
  if (!targets.length) return bad(res, "Target tidak valid.");

  const reason = String(req.body.reason || "").trim().slice(0, 300);
  let until = null;
  if (req.body.until) {
    until = new Date(req.body.until);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return bad(res, "Target tidak valid.");
  }

  for (const t of targets) {
    if (t.kind === "email" && (owners().has(t.value) || t.value === req.ops.email)) return bad(res, "Target ini tidak boleh dibatasi.");
    if (t.kind === "ip") {
      // Never lock out the person doing it, and never the machine itself.
      if (r.covers(t.value, req.ip)) return bad(res, "Target ini tidak boleh dibatasi.");
      if (r.covers(t.value, "127.0.0.1") || r.covers(t.value, "::1")) return bad(res, "Target ini tidak boleh dibatasi.");
    }
  }

  const saved = [];
  for (const t of targets) {
    const row = await Restriction.findOneAndUpdate(
      { kind: t.kind, value: t.value, active: true },
      { $set: { reason, until, by: req.ops.email }, $setOnInsert: { kind: t.kind, value: t.value, active: true } },
      { upsert: true, new: true }
    ).lean();
    saved.push({ id: String(row._id), kind: row.kind, value: row.value });
    await record(req, "restriction.add", `${t.kind}:${t.value}`, { reason, until });
  }
  r.invalidate();
  res.status(201).json({ success: true, data: saved });
}

async function lift(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });
  const row = await Restriction.findOneAndUpdate({ _id: req.params.id, active: true }, { $set: { active: false } }, { new: true }).lean();
  if (!row) return res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });
  await record(req, "restriction.lift", `${row.kind}:${row.value}`, {});
  r.invalidate();
  res.json({ success: true });
}

module.exports = { list, add, lift };
