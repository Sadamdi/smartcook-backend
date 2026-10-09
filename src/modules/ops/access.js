"use strict";

const { Member, Trail, TRAIL_DAYS, DAY } = require("./models");

const PERMS = ["monitor", "devices", "live", "people", "restrict", "logs", "trail", "members", "notice"];

const owners = () =>
  new Set(
    String(process.env.OPS_OWNERS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

/**
 * What this signed-in user may do, or null.
 *
 * Membership is matched on the e-mail, so the e-mail must be PROVEN: the
 * account has to carry a Firebase uid (it signed in with Google at least once).
 * Registration by e-mail+password does not verify the address, so without this
 * rule anybody could register a member's address and inherit its rights.
 * The database is read on every call; nothing is trusted from the client.
 */
async function resolve(user) {
  if (!user || !user.email || !user.firebase_uid) return null;
  const email = String(user.email).toLowerCase();
  if (owners().has(email)) return { role: "owner", email, perms: new Set(PERMS) };
  const row = await Member.findOne({ email, active: true }).lean();
  if (!row) return null;
  return { role: "member", email, perms: new Set((row.perms || []).filter((p) => PERMS.includes(p))) };
}

const notFound = (res) => res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });

/** Same answer as an unknown route, so a non-member cannot tell the area exists. */
const gate = (perm) => async (req, res, next) => {
  const m = await resolve(req.user);
  if (!m || (perm && !m.perms.has(perm))) return notFound(res);
  req.ops = m;
  next();
};

const clientIp = (req) => req.ip || null;

async function record(req, action, target, meta) {
  try {
    await Trail.create({
      who: req.ops ? req.ops.email : "?",
      action,
      target: target || null,
      meta: meta || {},
      ip: clientIp(req),
      expiresAt: new Date(Date.now() + TRAIL_DAYS * DAY),
    });
  } catch (_) {
    // Never fail the request because the trail could not be written.
  }
}

module.exports = { PERMS, owners, resolve, gate, record, notFound, clientIp };
