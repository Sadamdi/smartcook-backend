"use strict";

const mongoose = require("mongoose");
const { Restriction } = require("./models");
const { owners, record } = require("./access");
const r = require("./restrictions");

const bad = (res, message) => res.status(400).json({ success: false, message });

const shapeRow = (x, now = Date.now()) => ({
  id: String(x._id),
  kind: x.kind,
  value: x.value,
  reason: x.reason,
  by: x.by,
  until: x.until,
  remainingSeconds: r.remaining(x.until, now),
  createdAt: x.createdAt,
});

/**
 * Active restrictions only (a time-limited one that has run out is gone).
 * Without `page` the answer is a plain list (older callers); with `page` it is
 * { items, total, page, pages } for `pageSize` rows, optionally for one
 * `kind` (ip | email) or a text search.
 */
async function list(req, res) {
  const now = Date.now();
  const filter = { active: true, $or: [{ until: null }, { until: { $gt: new Date(now) } }] };
  if (req.query.kind === "ip" || req.query.kind === "email") filter.kind = req.query.kind;
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q) filter.value = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (req.query.page === undefined) {
    const rows = await Restriction.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    return res.json({ success: true, data: rows.map((x) => shapeRow(x, now)) });
  }
  const size = Math.max(1, Math.min(50, Number(req.query.pageSize) || 10));
  const total = await Restriction.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
  const rows = await Restriction.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * size)
    .limit(size)
    .lean();
  res.json({ success: true, data: { items: rows.map((x) => shapeRow(x, now)), total, page, pages, pageSize: size } });
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
