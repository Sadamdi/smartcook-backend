// node scripts/test-profile.js : password step for Google accounts + onboarding name rules. No database.
process.env.JWT_SECRET = "test-only-secret";
const assert = require("assert");
const path = require("path");

const stub = (rel, exports) => {
  const id = require.resolve(path.join("..", rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};

let stored = {};
let lastUpdate = null;
const userDoc = (o) => ({ ...o, toJSON() { return { _id: o._id, email: o.email, name: o.name, auth_provider: o.auth_provider }; }, async save() { stored = { ...this }; } });
let db = {};
stub("src/models/User", {
  findById: (id) => ({
    select: () => {
      const doc = db[id] ? userDoc(db[id]) : null;
      global.__doc = doc;
      const p = Promise.resolve(doc);
      p.lean = async () => db[id] || null;
      return p;
    },
  }),
  findByIdAndUpdate: async (id, updates) => {
    lastUpdate = updates;
    return { ...db[id], ...updates };
  },
});

const users = require("../src/controllers/userController");
const auth = require("../src/controllers/authController");

const run = async (fn, req) => {
  let out = null;
  const res = { status(c) { this.code = c; return this; }, json(b) { out = { code: this.code || 200, body: b }; return this; } };
  await fn(req, res, (e) => { throw e; });
  return out;
};

let pass = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log("ok  -", name);
  } catch (e) {
    console.error("FAIL -", name, "\n   ", e.stack.split("\n").slice(0, 3).join("\n    "));
    process.exitCode = 1;
  }
};

(async () => {
  await t("profile tells a Google account without a password to set one, whenever it is asked", async () => {
    db = { g1: { _id: "g1", email: "g@example.com", name: "Gita", auth_provider: "google" } };
    const r = await run(users.getProfile, { user: userDoc(db.g1), headers: {}, ip: "1.1.1.1" });
    assert.strictEqual(r.body.data.needs_password, true);
  });
  await t("a Google account that has one, and an e-mail account, are not asked", async () => {
    db = {
      g2: { _id: "g2", email: "g2@example.com", auth_provider: "google", password: "hash" },
      e1: { _id: "e1", email: "e@example.com", auth_provider: "email", password: "hash" },
      e2: { _id: "e2", email: "e2@example.com", auth_provider: "email" },
    };
    for (const id of ["g2", "e1", "e2"]) {
      const r = await run(users.getProfile, { user: userDoc(db[id]), headers: {}, ip: "1.1.1.1" });
      assert.strictEqual(r.body.data.needs_password, false, id);
    }
  });
  await t("onboarding never blanks the name; a real name is kept trimmed", async () => {
    db = { u: { _id: "u", name: "Ani" } };
    await run(users.saveOnboarding, { user: { _id: "u" }, body: { name: "   ", age_range: "x" }, headers: {}, ip: "1.1.1.1" });
    assert.strictEqual(lastUpdate.name, undefined);
    await run(users.saveOnboarding, { user: { _id: "u" }, body: { name: "  Budi  " }, headers: {}, ip: "1.1.1.1" });
    assert.strictEqual(lastUpdate.name, "Budi");
    assert.strictEqual(lastUpdate.onboarding_completed, true);
  });
  await t("setting the Google password also saves the name that was typed", async () => {
    db = { g1: { _id: "g1", email: "g@example.com", name: "Gita G", auth_provider: "google" } };
    const r = await run(auth.setGooglePassword, { user: { _id: "g1" }, body: { new_password: "secret1", confirm_password: "secret1", name: "  Gita Baru " }, headers: {}, ip: "1.1.1.1" });
    assert.strictEqual(r.body.success, true);
    assert.strictEqual(global.__doc.name, "Gita Baru");
    assert.strictEqual(global.__doc.password, "secret1");
  });
  console.log("\n" + pass + " checks passed");
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
