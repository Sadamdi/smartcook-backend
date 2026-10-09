"use strict";

const { Member } = require("./models");
const { PERMS, owners, record } = require("./access");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Permissions the actor may hand out. Only an owner can hand out "members". */
function grantable(actor, wanted) {
  const list = Array.isArray(wanted) ? wanted.filter((p) => PERMS.includes(p)) : [];
  const unique = [...new Set(list)];
  if (actor.role === "owner") return { ok: true, perms: unique };
  const bad = unique.filter((p) => p === "members" || !actor.perms.has(p));
  return bad.length ? { ok: false, perms: [] } : { ok: true, perms: unique };
}

const bad = (res, message) => res.status(400).json({ success: false, message });

async function list(req, res) {
  const rows = await Member.find({}).sort({ createdAt: 1 }).lean();
  res.json({
    success: true,
    data: {
      owners: [...owners()],
      members: rows.map((r) => ({ email: r.email, perms: r.perms, active: r.active, addedBy: r.addedBy, createdAt: r.createdAt })),
      allPerms: PERMS,
    },
  });
}

async function add(req, res) {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!EMAIL.test(email)) return bad(res, "Email tidak valid.");
  if (owners().has(email)) return bad(res, "Email ini tidak bisa diubah.");
  const g = grantable(req.ops, req.body.perms);
  if (!g.ok) return bad(res, "Izin tidak boleh diberikan.");
  const row = await Member.findOneAndUpdate(
    { email },
    { $set: { perms: g.perms, active: true }, $setOnInsert: { addedBy: req.ops.email } },
    { upsert: true, new: true }
  ).lean();
  await record(req, "member.add", email, { perms: g.perms });
  res.status(201).json({ success: true, data: { email: row.email, perms: row.perms, active: row.active } });
}

async function update(req, res) {
  const email = String(req.params.email || "").trim().toLowerCase();
  if (email === req.ops.email) return bad(res, "Tidak bisa mengubah akun sendiri.");
  if (owners().has(email)) return bad(res, "Email ini tidak bisa diubah.");
  const row = await Member.findOne({ email });
  if (!row) return res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });
  if (req.body.perms !== undefined) {
    const g = grantable(req.ops, req.body.perms);
    if (!g.ok) return bad(res, "Izin tidak boleh diberikan.");
    // A non-owner cannot strip a right it does not hold from someone else either.
    if (req.ops.role !== "owner") {
      const removed = (row.perms || []).filter((p) => !g.perms.includes(p));
      if (removed.some((p) => p === "members" || !req.ops.perms.has(p))) return bad(res, "Izin tidak boleh diberikan.");
    }
    row.perms = g.perms;
  }
  if (typeof req.body.active === "boolean") row.active = req.body.active;
  await row.save();
  await record(req, "member.update", email, { perms: row.perms, active: row.active });
  res.json({ success: true, data: { email: row.email, perms: row.perms, active: row.active } });
}

async function remove(req, res) {
  const email = String(req.params.email || "").trim().toLowerCase();
  if (email === req.ops.email) return bad(res, "Tidak bisa mengubah akun sendiri.");
  if (owners().has(email)) return bad(res, "Email ini tidak bisa diubah.");
  const row = await Member.findOne({ email }).lean();
  if (!row) return res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });
  if (req.ops.role !== "owner" && (row.perms || []).includes("members")) return bad(res, "Izin tidak boleh diberikan.");
  await Member.deleteOne({ email });
  await record(req, "member.remove", email, {});
  res.json({ success: true });
}

module.exports = { grantable, list, add, update, remove, EMAIL };
