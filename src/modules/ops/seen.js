"use strict";

const mongoose = require("mongoose");
const { Seen, Login, SEEN_DAYS, DAY } = require("./models");
const restrictions = require("./restrictions");

const TOUCH_EVERY_MS = 30 * 1000;
const ONLINE_MS = 2 * 60 * 1000;
const lastTouch = new Map(); // installId -> ms

const clip = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));

/**
 * Called by the debug-log intake after a batch is stored. Best effort: it can
 * never make the intake fail, and it writes at most once per install per 30 s.
 * `docs` are the already sanitised events of the batch; `ip` is the real
 * client address (req.ip, never a header the client could have written).
 */
async function touch(docs, ip) {
  try {
    if (!Array.isArray(docs) || !docs.length) return;
    const last = docs[docs.length - 1];
    const installId = clip(last.installId, 64);
    if (!installId) return;
    const now = Date.now();
    if (now - (lastTouch.get(installId) || 0) < TOUCH_EVERY_MS) return;
    lastTouch.set(installId, now);
    if (lastTouch.size > 5000) lastTouch.clear();

    // First non-empty value across the batch, so a late partial event does not blank a field.
    const pick = (k) => {
      for (let i = docs.length - 1; i >= 0; i--) if (docs[i][k] !== undefined && docs[i][k] !== null && docs[i][k] !== "") return docs[i][k];
      return null;
    };
    const set = {
      userId: pick("userId"),
      deviceModel: clip(pick("deviceModel"), 80),
      manufacturer: clip(pick("deviceManufacturer"), 80),
      osVersion: clip(pick("osVersion"), 40),
      sdkInt: pick("sdkInt"),
      appVersion: clip(pick("appVersion"), 40),
      appBuild: pick("appBuild"),
      abi: clip(pick("abi"), 20),
      locale: clip(pick("locale"), 20),
      country: clip(pick("country") || pick("simCountryIso"), 8),
      timezone: clip(pick("timezone"), 60),
      carrier: clip(pick("carrierName"), 60),
      ip: clip(ip, 64),
      userAgent: clip(pick("userAgent"), 200),
      lastSeen: new Date(now),
      lastEvent: clip(last.event, 60),
      expiresAt: new Date(now + SEEN_DAYS * DAY),
    };
    for (const k of Object.keys(set)) if (set[k] === null && k !== "ip") delete set[k];
    await Seen.updateOne({ installId }, { $set: set, $setOnInsert: { firstSeen: new Date(now) }, $inc: { batches: 1 } }, { upsert: true });
  } catch (_) {
    // never fail the intake
  }
}

/** One row per successful sign-in. */
async function recordLogin(req, user, via) {
  try {
    if (!user || !user._id) return;
    await Login.create({
      userId: String(user._id),
      ip: clip(req.ip, 64),
      userAgent: clip(req.headers && req.headers["user-agent"], 200),
      via: clip(via, 20),
      at: new Date(),
      expiresAt: new Date(Date.now() + SEEN_DAYS * DAY),
    });
  } catch (_) {
    // never fail a sign-in because of bookkeeping
  }
}

const shape = (r, users, now = Date.now()) => ({
  installId: r.installId,
  userId: r.userId,
  user: r.userId && users.get(r.userId) ? users.get(r.userId) : null,
  deviceModel: r.deviceModel,
  manufacturer: r.manufacturer,
  osVersion: r.osVersion,
  appVersion: r.appVersion,
  appBuild: r.appBuild,
  abi: r.abi,
  locale: r.locale,
  country: r.country,
  timezone: r.timezone,
  carrier: r.carrier,
  ip: r.ip,
  restricted: !!(r.ip && restrictions.ipRestricted(r.ip)),
  firstSeen: r.firstSeen,
  lastSeen: r.lastSeen,
  online: !!r.lastSeen && now - new Date(r.lastSeen).getTime() < ONLINE_MS,
  batches: r.batches,
  lastEvent: r.lastEvent,
});

async function usersFor(rows) {
  const ids = [...new Set(rows.map((r) => r.userId).filter((id) => id && mongoose.isValidObjectId(id)))];
  const map = new Map();
  if (!ids.length) return map;
  const User = require("../../models/User");
  const found = await User.find({ _id: { $in: ids } }).select("email name").lean();
  for (const u of found) map.set(String(u._id), { email: u.email, name: u.name });
  return map;
}

/** Newest first; `online` keeps only installs seen in the last two minutes. */
async function list({ q, online, limit = 50, before } = {}) {
  const filter = {};
  const n = Math.max(1, Math.min(100, Number(limit) || 50));
  if (online) filter.lastSeen = { $gt: new Date(Date.now() - ONLINE_MS) };
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) filter.lastSeen = { ...(filter.lastSeen || {}), $lt: d };
  }
  if (q) {
    const text = String(q).trim().slice(0, 60);
    if (text) {
      const rx = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const User = require("../../models/User");
      const hit = await User.find({ $or: [{ email: rx }, { name: rx }] }).select("_id").limit(50).lean();
      filter.$or = [{ deviceModel: rx }, { manufacturer: rx }, { ip: rx }, { installId: rx }, { userId: { $in: hit.map((u) => String(u._id)) } }];
    }
  }
  const rows = await Seen.find(filter).sort({ lastSeen: -1 }).limit(n).lean();
  const users = await usersFor(rows);
  return rows.map((r) => shape(r, users));
}

async function detail(installId) {
  const row = await Seen.findOne({ installId: String(installId).slice(0, 64) }).lean();
  if (!row) return null;
  const users = await usersFor([row]);
  const DevLog = require("../devlog/model");
  const events = await DevLog.find({ installId: row.installId })
    .sort({ createdAt: -1 })
    .limit(60)
    .select("event action level error statusCode appBuild networkType batteryLevel createdAt")
    .lean();
  const logins = row.userId ? await Login.find({ userId: row.userId }).sort({ at: -1 }).limit(50).select("ip via at userAgent").lean() : [];
  return { device: shape(row, users), events, logins };
}

module.exports = { touch, recordLogin, list, detail, ONLINE_MS };
