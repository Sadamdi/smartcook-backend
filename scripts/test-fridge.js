// node scripts/test-fridge.js : fridge rules, no database (models are stubbed).
const assert = require("assert");
const path = require("path");

const stub = (rel, exports) => {
  const id = require.resolve(path.join("..", rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};

// ---- in-memory stand-in for the FridgeItem model
let rows = [];
let seq = 0;
const matches = (row, q) =>
  Object.entries(q).every(([k, v]) => (v instanceof RegExp ? v.test(String(row[k])) : String(row[k]) === String(v)));
const wrap = (row) => Object.assign(row, { save: async () => row });
const FridgeItem = {
  findOne: async (q) => rows.find((r) => matches(r, q)) || null,
  create: async (d) => {
    const row = wrap({ _id: String(++seq).padStart(24, "0"), ...d });
    rows.push(row);
    return row;
  },
  find: async () => rows,
  findOneAndDelete: async (q) => {
    const i = rows.findIndex((r) => matches(r, q));
    return i < 0 ? null : rows.splice(i, 1)[0];
  },
};
stub("src/models/FridgeItem", FridgeItem);
stub("src/models/Recipe", { findById: async () => null });
stub("src/models/Ingredient", { findOneAndUpdate: async () => ({ _id: "x", name: "x", category: "bumbu" }) });
stub("src/utils/logger", { logEvent: () => {}, buildRequestContext: () => ({}) });

const fridge = require("../src/utils/fridge");
const ctrl = require("../src/controllers/fridgeController");

let pass = 0;
const t = async (name, fn) => {
  try {
    rows = [];
    await fn();
    pass++;
    console.log("ok  -", name);
  } catch (e) {
    console.error("FAIL -", name, "\n   ", e.message);
    process.exitCode = 1;
  }
};

const call = async (fn, { body = {}, params = {} } = {}) => {
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await fn({ body, params, user: { _id: "u1" } }, res, (e) => { throw e; });
  return out;
};

(async () => {
  await t("quantity: numbers and numeric strings are accepted, junk is rejected", () => {
    assert.deepStrictEqual(fridge.parseQuantity(2), { ok: true, value: 2 });
    assert.deepStrictEqual(fridge.parseQuantity("2"), { ok: true, value: 2 });
    assert.deepStrictEqual(fridge.parseQuantity("0,5"), { ok: true, value: 0.5 });
    assert.deepStrictEqual(fridge.parseQuantity(undefined), { ok: true, value: 0 });
    for (const bad of ["abc", -1, NaN, Infinity, 1e9, {}, [], "1e400"]) assert.strictEqual(fridge.parseQuantity(bad).ok, false, String(bad));
  });

  await t("recipe quantities: fractions are not glued into 12", () => {
    assert.strictEqual(fridge.parseLooseQuantity("1/2"), 0.5);
    assert.strictEqual(fridge.parseLooseQuantity("1 1/2 sdm"), 1.5);
    assert.strictEqual(fridge.parseLooseQuantity("1,5 kg"), 1.5);
    assert.strictEqual(fridge.parseLooseQuantity("200 gram"), 200);
    assert.strictEqual(fridge.parseLooseQuantity("secukupnya"), 0);
    assert.strictEqual(fridge.parseLooseQuantity(null), 0);
  });

  await t("expiry: empty means none, nonsense is rejected", () => {
    assert.strictEqual(fridge.parseExpiry("").value, null);
    assert.strictEqual(fridge.parseExpiry(null).value, null);
    assert.ok(fridge.parseExpiry("2026-10-20T00:00:00.000Z").value instanceof Date);
    assert.strictEqual(fridge.parseExpiry("besok").ok, false);
  });

  await t("categories: short words match whole words only", () => {
    const c = fridge.classifyIngredientCategory;
    assert.strictEqual(c("minyak goreng"), "bumbu");
    assert.strictEqual(c("kemiri"), "bumbu");
    assert.strictEqual(c("lemon"), "bumbu");
    assert.strictEqual(c("mi instan"), "karbo");
    assert.strictEqual(c("Nasi putih"), "karbo");
    assert.strictEqual(c("Kol"), "sayur");
    assert.strictEqual(c("dada ayam"), "protein");
    assert.strictEqual(c(""), "bumbu");
  });

  await t("add: the same ingredient in another letter case is merged, not duplicated", async () => {
    await call(ctrl.addFridgeItem, { body: { ingredient_name: "Ayam", category: "protein", quantity: 200, unit: "gram" } });
    const r = await call(ctrl.addFridgeItem, { body: { ingredient_name: "  ayam ", category: "protein", quantity: 100, unit: "Gram" } });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].quantity, 300);
    assert.strictEqual(r.status, 200);
  });

  await t("add: a string quantity is added as a number (5 + \"2\" is 7, not 52)", async () => {
    await call(ctrl.addFridgeItem, { body: { ingredient_name: "Telur", category: "protein", quantity: 5, unit: "pcs" } });
    await call(ctrl.addFridgeItem, { body: { ingredient_name: "Telur", category: "protein", quantity: "2", unit: "pcs" } });
    assert.strictEqual(rows[0].quantity, 7);
  });

  await t("add: a different unit is a separate item (200 gram is not 200 pcs)", async () => {
    await call(ctrl.addFridgeItem, { body: { ingredient_name: "Tepung", category: "karbo", quantity: 2, unit: "pcs" } });
    await call(ctrl.addFridgeItem, { body: { ingredient_name: "Tepung", category: "karbo", quantity: 200, unit: "gram" } });
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows.map((r) => r.quantity).sort(), [2, 200]);
  });

  await t("add: bad input is refused with 400 and nothing is stored", async () => {
    for (const body of [
      { ingredient_name: "Ayam", category: "protein", quantity: "banyak" },
      { ingredient_name: "Ayam", category: "protein", quantity: -3 },
      { ingredient_name: "Ayam", category: "protein", quantity: 5, expired_date: "kapan-kapan" },
      { ingredient_name: "x".repeat(101), category: "protein" },
      { ingredient_name: "Ayam", category: "minuman" },
      { ingredient_name: "   ", category: "protein" },
    ]) {
      const r = await call(ctrl.addFridgeItem, { body });
      assert.strictEqual(r.status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.strictEqual(rows.length, 0);
  });

  await t("update: quantity is validated, expiry can be cleared, bad ids are 404", async () => {
    const created = await call(ctrl.addFridgeItem, { body: { ingredient_name: "Susu", category: "protein", quantity: 1, unit: "liter", expired_date: "2026-10-20T00:00:00.000Z" } });
    const id = created.body.data._id;
    assert.strictEqual((await call(ctrl.updateFridgeItem, { params: { id }, body: { quantity: "abc" } })).status, 400);
    assert.strictEqual((await call(ctrl.updateFridgeItem, { params: { id }, body: { expired_date: "nope" } })).status, 400);
    const ok = await call(ctrl.updateFridgeItem, { params: { id }, body: { quantity: "2,5", expired_date: null } });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(rows[0].quantity, 2.5);
    assert.strictEqual(rows[0].expired_date, null);
    assert.strictEqual((await call(ctrl.updateFridgeItem, { params: { id: "not-an-id" }, body: { quantity: 1 } })).status, 404);
    assert.strictEqual((await call(ctrl.deleteFridgeItem, { params: { id: "not-an-id" } })).status, 404);
  });

  console.log(`\n${pass} checks passed`);
})();
