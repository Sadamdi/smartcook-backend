"use strict";

const mongoose = require("mongoose");
const { Seen, Login, SEEN_DAYS, DAY } = require("./models");
const restrictions = require("./restrictions");
const geo = require("./geo");

const TOUCH_EVERY_MS = 30 * 1000;
const ONLINE_MS = 150 * 1000; // a phone reports every minute while the app is open
const BEAT_WRITE_MS = 20 * 1000;
const lastBeatWrite = new Map();
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

/** Remember where an address is, once per address change. Never blocks or throws. */
function ensureGeo(installId, ip, known) {
  if (!ip || known === ip) return;
  geo
    .lookup(ip)
    .then((g) => (g ? Seen.updateOne({ installId }, { $set: { geo: g, geoIp: ip } }) : null))
    .catch(() => {});
}

/**
 * Called by every phone reading (about once a minute while the app is open).
 * This is what makes a phone "connected", and it keeps the newest reading so
 * the last known state is still there once the phone goes quiet.
 */
async function touchBeat({ installId, ip, userId, reading, hw, build }) {
  try {
    if (!installId) return;
    const now = Date.now();
    const known = await Seen.findOne({ installId }).lean();
    const changed = !known || known.ip !== ip || (userId && known.userId !== String(userId)) || !!hw;
    if (!changed && now - (lastBeatWrite.get(installId) || 0) < BEAT_WRITE_MS) return;
    lastBeatWrite.set(installId, now);
    if (lastBeatWrite.size > 5000) lastBeatWrite.clear();
    const set = { lastSeen: new Date(now), lastEvent: "beat", ip: clip(ip, 64), lastLive: { ...reading, at: now }, expiresAt: new Date(now + SEEN_DAYS * DAY) };
    if (userId) set.userId = String(userId);
    if (hw) {
      set.hw = hw;
      if (hw.brand) set.manufacturer = hw.brand;
      if (hw.model) set.deviceModel = hw.model;
      if (hw.android) set.osVersion = hw.android;
      if (hw.sdk) set.sdkInt = hw.sdk;
      if (hw.abis && hw.abis[0]) set.abi = hw.abis[0];
    }
    if (build) set.appBuild = build;
    await Seen.updateOne({ installId }, { $set: set, $setOnInsert: { firstSeen: new Date(now) } }, { upsert: true });
    ensureGeo(installId, set.ip, known && known.geoIp);
  } catch (_) {
    // bookkeeping only
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
  country: (r.geo && r.geo.country) || r.country,
  place: r.geo ? [r.geo.city, r.geo.region, r.geo.countryName].filter(Boolean).join(", ") : null,
  isp: r.geo ? r.geo.isp : null,
  timezone: (r.geo && r.geo.timezone) || r.timezone,
  carrier: r.carrier,
  ip: r.ip,
  restricted: !!(r.ip && restrictions.ipRestricted(r.ip)),
  firstSeen: r.firstSeen,
  lastSeen: r.lastSeen,
  online: !!r.lastSeen && now - new Date(r.lastSeen).getTime() < ONLINE_MS,
  batches: r.batches,
  lastEvent: r.lastEvent,
  lastLive: r.lastLive || null,
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
async function list({ q, online, limit = 50, before, page, pageSize } = {}) {
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
  if (page !== undefined && page !== null) {
    // Paged mode: { items, total, page, pages } with `pageSize` rows each.
    const size = Math.max(1, Math.min(50, Number(pageSize) || 10));
    const total = await Seen.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / size));
    const p = Math.min(pages, Math.max(1, Number(page) || 1));
    const rows = await Seen.find(filter).sort({ lastSeen: -1 }).skip((p - 1) * size).limit(size).lean();
    const users = await usersFor(rows);
    return { items: rows.map((r) => shape(r, users)), total, page: p, pages, pageSize: size };
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
  return { device: { ...shape(row, users), hw: row.hw || null }, events, logins };
}

module.exports = { touch, touchBeat, recordLogin, list, detail, ONLINE_MS };
