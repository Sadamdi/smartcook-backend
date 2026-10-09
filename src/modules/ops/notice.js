"use strict";

const { Notice } = require("./models");
const { record } = require("./access");

const KEY = "main";
const clean = (v) => String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 280);

const shape = (n) => (n ? { id: String(new Date(n.updatedAt).getTime()), id_text: n.idText, en_text: n.enText, active: n.active, until: n.until, mode: n.mode || "always" } : null);

/** Public: the banner every app may show (a plain announcement, no personal data). */
async function publicNotice(req, res) {
  let n = null;
  try {
    n = await Notice.findOne({ key: KEY, active: true }).lean();
  } catch (_) {
    n = null;
  }
  if (!n || (n.until && new Date(n.until).getTime() <= Date.now())) return res.json({ success: true, data: null });
  const en = req.lang === "en";
  const text = (en ? n.enText || n.idText : n.idText || n.enText) || "";
  if (!text) return res.json({ success: true, data: null });
  res.json({ success: true, data: { id: String(new Date(n.updatedAt).getTime()), text, mode: n.mode === "once" ? "once" : "always" } });
}

async function get(req, res) {
  res.json({ success: true, data: shape(await Notice.findOne({ key: KEY }).lean()) });
}

async function put(req, res) {
  const idText = clean(req.body.idText);
  const enText = clean(req.body.enText);
  const mode = req.body.mode === "once" ? "once" : "always";
  const active = req.body.active === true && !!(idText || enText);
  let until = null;
  if (req.body.until) {
    until = new Date(req.body.until);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
      return res.status(400).json({ success: false, message: "Target tidak valid." });
    }
  }
  const row = await Notice.findOneAndUpdate(
    { key: KEY },
    { $set: { idText, enText, active, until, mode, updatedBy: req.ops.email, updatedAt: new Date() } },
    { upsert: true, new: true }
  ).lean();
  await record(req, "notice.set", null, { active, mode });
  res.json({ success: true, data: shape(row) });
}

module.exports = { publicNotice, get, put, clean };
