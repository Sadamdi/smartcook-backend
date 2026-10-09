"use strict";

const mongoose = require("mongoose");
const { Seen, Login, Restriction, Trail } = require("./models");
const restrictions = require("./restrictions");
const { ONLINE_MS } = require("./seen");

const DAY = 24 * 60 * 60 * 1000;
const rx = (text) => new RegExp(String(text).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const lim = (v, def = 50, max = 100) => Math.max(1, Math.min(max, Number(v) || def));

/** Numbers for the front page. */
async function overview() {
  const User = require("../../models/User");
  const DevLog = require("../devlog/model");
  const now = Date.now();
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
  const [users, newToday, online, devices, blocked, errors, builds] = await Promise.all([
    User.estimatedDocumentCount(),
    User.countDocuments({ created_at: { $gte: startOfDay } }),
    Seen.countDocuments({ lastSeen: { $gt: new Date(now - ONLINE_MS) } }),
    Seen.countDocuments({}),
    Restriction.countDocuments({ active: true }),
    DevLog.aggregate([
      { $match: { level: "error", createdAt: { $gte: new Date(now - DAY) } } },
      { $group: { _id: { b: "$appBuild", i: "$installId" }, n: { $sum: 1 } } },
      { $group: { _id: "$_id.b", errors: { $sum: "$n" }, devices: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 12 },
    ]),
    Seen.aggregate([{ $group: { _id: "$appBuild", devices: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 12 }]),
  ]);
  return {
    users,
    newToday,
    devices,
    online,
    restrictions: blocked,
    errorsByBuild: errors.map((e) => ({ build: e._id, errors: e.errors, devices: e.devices })),
    buildMix: builds.map((b) => ({ build: b._id, devices: b.devices })),
  };
}

/** Plain debug-log feed. The addresses in it are already masked at intake. */
async function logs({ level, event, build, installId, before, limit } = {}) {
  const DevLog = require("../devlog/model");
  const q = {};
  if (level) q.level = String(level).slice(0, 12);
  if (event) q.event = String(event).slice(0, 60);
  if (build && Number.isFinite(Number(build))) q.appBuild = Number(build);
  if (installId) q.installId = String(installId).slice(0, 64);
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) q.createdAt = { $lt: d };
  }
  return DevLog.find(q)
    .sort({ createdAt: -1 })
    .limit(lim(limit))
    .select("installId event action level error statusCode appBuild appVersion deviceModel deviceManufacturer osVersion networkType batteryLevel createdAt")
    .lean();
}

async function trail({ limit, before } = {}) {
  const q = {};
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) q.at = { $lt: d };
  }
  return Trail.find(q).sort({ at: -1 }).limit(lim(limit)).select("who action target meta ip at").lean();
}

const userShape = (u, devices = 0) => ({
  id: String(u._id),
  email: u.email,
  name: u.name || "",
  provider: u.auth_provider,
  verifiedWithGoogle: !!u.firebase_uid,
  onboarded: !!u.onboarding_completed,
  createdAt: u.created_at,
  devices,
  suspended: !!restrictions.emailRestricted(u.email),
});

const SAFE = "email name auth_provider firebase_uid onboarding_completed created_at";

/** Search by e-mail or name; never returns secrets (password, codes, counters). */
async function users({ q, limit } = {}) {
  const User = require("../../models/User");
  const filter = q && String(q).trim() ? { $or: [{ email: rx(q) }, { name: rx(q) }] } : {};
  const rows = await User.find(filter).select(SAFE).sort({ created_at: -1 }).limit(lim(limit)).lean();
  const ids = rows.map((r) => String(r._id));
  const seen = ids.length ? await Seen.find({ userId: { $in: ids } }).select("userId").lean() : [];
  const count = new Map();
  for (const s of seen) count.set(s.userId, (count.get(s.userId) || 0) + 1);
  return rows.map((r) => userShape(r, count.get(String(r._id)) || 0));
}

async function userDetail(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const User = require("../../models/User");
  const u = await User.findById(id).select(SAFE).lean();
  if (!u) return null;
  const devices = await Seen.find({ userId: String(u._id) }).sort({ lastSeen: -1 }).limit(20).lean();
  const logins = await Login.find({ userId: String(u._id) }).sort({ at: -1 }).limit(50).select("ip via at userAgent").lean();
  return {
    user: userShape(u, devices.length),
    devices: devices.map((d) => ({ installId: d.installId, deviceModel: d.deviceModel, manufacturer: d.manufacturer, appBuild: d.appBuild, ip: d.ip, lastSeen: d.lastSeen })),
    logins,
  };
}

module.exports = { overview, logs, trail, users, userDetail };
