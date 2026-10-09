// Pure helpers for the fridge endpoints (no database), so they can be tested.

const MAX_QUANTITY = 1000000;
const MAX_NAME = 100;
const CATEGORIES = ["protein", "karbo", "sayur", "bumbu"];

/**
 * Quantity from a JSON body. Accepts a number or a numeric string ("2", "0,5");
 * anything else is rejected instead of being stored as 0 or concatenated as text
 * (`5 + "2"` is "52" in JavaScript).
 * Returns { ok: true, value } or { ok: false }.
 */
function parseQuantity(raw, { fallback = 0 } = {}) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: fallback };
  if (typeof raw !== "number" && typeof raw !== "string") return { ok: false };
  const n = typeof raw === "number" ? raw : Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > MAX_QUANTITY) return { ok: false };
  return { ok: true, value: n };
}

/**
 * Quantity written in a recipe: "200", "1,5", "1/2", "1 1/2 sdm", "secukupnya".
 * Never throws; unreadable text gives 0. (Stripping every non-digit used to turn
 * "1/2" into 12.)
 */
function parseLooseQuantity(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.min(raw, MAX_QUANTITY) : 0;
  const t = String(raw === undefined || raw === null ? "" : raw).toLowerCase().replace(",", ".");
  const mixed = /(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(t);
  if (mixed && Number(mixed[3]) > 0) return Math.min(Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]), MAX_QUANTITY);
  const frac = /(\d+)\s*\/\s*(\d+)/.exec(t);
  if (frac && Number(frac[2]) > 0) return Math.min(Number(frac[1]) / Number(frac[2]), MAX_QUANTITY);
  const num = /\d+(\.\d+)?/.exec(t);
  return num ? Math.min(Number(num[0]), MAX_QUANTITY) : 0;
}

/** Expiry date from a JSON body: undefined/null/"" -> null, bad date -> { ok: false }. */
function parseExpiry(raw) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d };
}

function cleanName(raw) {
  return String(raw === undefined || raw === null ? "" : raw)
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive exact match on a name, for Mongo `$regex`. */
const exactCI = (s) => new RegExp(`^${escapeRegex(s)}$`, "i");

const has = (s, words) => words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(s));

/**
 * Best-effort category for an ingredient that came from a recipe. Short words
 * ("mi", "kol") must match as whole words: a plain substring test made
 * "minyak", "kemiri" and "lemon" carbohydrates.
 */
function classifyIngredientCategory(name) {
  const s = String(name || "").toLowerCase();
  if (!s.trim()) return "bumbu";
  if (/(ayam|daging|telur|ikan|udang|sapi|kambing|tahu|tempe|cumi|sosis|bakso)/.test(s)) return "protein";
  if (has(s, ["nasi", "beras", "mie", "mi", "bihun", "soun", "kentang", "roti", "tepung", "pasta", "spaghetti", "makaroni", "singkong", "ubi"])) return "karbo";
  if (has(s, ["wortel", "kol", "kubis", "selada", "tomat", "bayam", "sayur", "brokoli", "kangkung", "sawi", "buncis", "timun", "mentimun", "terong", "jagung", "labu", "kembang kol"])) return "sayur";
  return "bumbu";
}

module.exports = {
  MAX_QUANTITY,
  MAX_NAME,
  CATEGORIES,
  parseQuantity,
  parseExpiry,
  parseLooseQuantity,
  cleanName,
  escapeRegex,
  exactCI,
  classifyIngredientCategory,
};
