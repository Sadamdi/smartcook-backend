// node scripts/test-i18n.js : message translation + e-mail language. No network, no database.
const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("assert");
const express = require("express");
const nodemailer = require("nodemailer");

const sent = [];
nodemailer.createTransport = () => ({ sendMail: async (m) => sent.push(m) });

const i18n = require("../src/utils/i18n");
const { sendOTPEmail } = require("../src/utils/email");

let pass = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log("ok  -", name);
  } catch (e) {
    console.error("FAIL -", name, "\n   ", e.message);
    process.exitCode = 1;
  }
};

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });

const root = path.join(__dirname, "..");
const files = [...walk(path.join(root, "src")), path.join(root, "server.js")].filter((f) => !/[\\/](devlog|secure)[\\/]/.test(f));

(async () => {
  await t("every message in src/ has an English text", () => {
    const missing = new Set();
    const re = /message\s*:\s*(?:\n\s*)?([`"'])((?:\\.|(?!\1)[^])*)\1/g;
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      let m;
      while ((m = re.exec(src))) {
        let text = m[2].replace(/\s*\n\s*/g, " ");
        if (text === "SmartCook API is running") continue;
        // fill template holes with sample values
        text = text
          .replace(/\$\{[^}]*secondsLeft[^}]*\}/g, "3")
          .replace(/\$\{retryAfter\} detik/g, "30 detik")
          .replace(/\$\{retryAfter\}/g, "30 detik")
          .replace(/\$\{user\.auth_provider\}/g, "Google")
          .replace(/\$\{[^}]*\}/g, "1");
        const en = i18n.translate(text, "en");
        if (en === text && !/^Server error\.$/.test(text)) missing.add(`${path.relative(root, f)}: ${text}`);
      }
    }
    // dynamic messages that the regex cannot see
    assert.deepStrictEqual([...missing], [], "no English text for:\n" + [...missing].join("\n"));
  });

  await t("numbers and names are kept", () => {
    assert.strictEqual(i18n.translate("Terlalu sering meminta OTP. Coba lagi dalam 45 detik.", "en"), "You are requesting codes too often. Try again in 45 seconds.");
    assert.strictEqual(i18n.translate("Terlalu sering meminta kode. Coba lagi dalam 1 detik.", "en"), "You are requesting codes too often. Try again in 1 second.");
    assert.strictEqual(i18n.translate("Terlalu banyak percobaan login. Coba lagi dalam 4 menit.", "en"), "Too many sign-in attempts. Try again in 4 minutes.");
    assert.strictEqual(i18n.translate("Terlalu banyak pesan. Coba lagi dalam 2 menit.", "en"), "Too many messages. Try again in 2 minutes.");
    assert.ok(i18n.translate("Akun ini terdaftar melalui Google. Reset password tidak tersedia.", "en").includes("Google"));
  });

  await t("Indonesian and unknown text pass through untouched", () => {
    assert.strictEqual(i18n.translate("Kode OTP salah.", "id"), "Kode OTP salah.");
    assert.strictEqual(i18n.translate("Pesan baru yang belum ada", "en"), "Pesan baru yang belum ada");
    assert.strictEqual(i18n.translate(undefined, "en"), undefined);
  });

  await t("language is read from X-Smartcook-Locale, then Accept-Language", () => {
    assert.strictEqual(i18n.langOf({ headers: { "x-smartcook-locale": "en" } }), "en");
    assert.strictEqual(i18n.langOf({ headers: { "x-smartcook-locale": "en-US" } }), "en");
    assert.strictEqual(i18n.langOf({ headers: { "x-smartcook-locale": "id" } }), "id");
    assert.strictEqual(i18n.langOf({ headers: { "accept-language": "en-GB,en;q=0.9" } }), "en");
    assert.strictEqual(i18n.langOf({ headers: {} }), "id");
  });

  await t("middleware translates JSON answers per request", async () => {
    const app = express();
    app.use(i18n.middleware());
    app.post("/x", (req, res) => res.status(400).json({ success: false, message: "Kode OTP salah.", data: { keep: 1 } }));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const call = (headers) =>
      new Promise((resolve, reject) => {
        const rq = http.request({ port: srv.address().port, path: "/x", method: "POST", headers }, (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve(JSON.parse(b)));
        });
        rq.on("error", reject);
        rq.end();
      });
    try {
      const en = await call({ "X-Smartcook-Locale": "en" });
      const id = await call({ "X-Smartcook-Locale": "id" });
      const none = await call({});
      assert.strictEqual(en.message, "Wrong code.");
      assert.strictEqual(en.data.keep, 1);
      assert.strictEqual(id.message, "Kode OTP salah.");
      assert.strictEqual(none.message, "Kode OTP salah.");
    } finally {
      srv.close();
    }
  });

  await t("every OTP e-mail exists in both languages and has no leftovers", async () => {
    const purposes = ["verify", "reset-password", "change-password", "change-email", "login-lock", "delete-account"];
    const idWords = ["Halo", "Masukkan", "Berlaku", "Jika ", "Kalau ", "Email ini dikirim", "Akun yang"];
    for (const p of purposes) {
      sent.length = 0;
      await sendOTPEmail("a@b.co", "123456", { purpose: p, name: "Adit", lang: "en" });
      await sendOTPEmail("a@b.co", "123456", { purpose: p, name: "Adit", lang: "id" });
      const [en, id] = sent;
      assert.ok(en.html.includes("123456") && id.html.includes("123456"), p + " lost the code");
      assert.notStrictEqual(en.subject, id.subject, p + " subject not translated");
      for (const w of idWords) assert.ok(!en.html.includes(w) && !en.subject.includes(w), `${p} (en) still says "${w}"`);
      assert.ok(en.html.includes("Hello <strong>Adit</strong>"), p + " greeting");
      assert.ok(id.html.includes("Halo <strong>Adit</strong>"), p + " greeting id");
      assert.ok(en.html.includes("Valid for 10 minutes") && id.html.includes("Berlaku 10 menit"));
      assert.ok(!/object Object/.test(en.html + id.html), p + " leaked [object Object]");
    }
    sent.length = 0;
    await sendOTPEmail("a@b.co", "1", { purpose: "verify" });
    assert.ok(sent[0].html.includes("Halo,"), "default language stays Indonesian");
  });

  await t("the language travels inside the sealed channel (end to end)", async () => {
    const secure = require("../src/modules/secure/channel");
    const kp = secure.generateKeyPair();
    const keys = secure.loadKeys({ API_PRIVATE_KEY: kp.privateKey });
    const app = express();
    app.use(express.json());
    app.use(secure.middleware({ getKeys: () => keys, requireEncrypted: () => false }));
    app.use(i18n.middleware());
    app.post("/api/auth/verify", (req, res) => res.status(400).json({ success: false, message: "Kode OTP salah." }));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const call = (locale) =>
      new Promise((resolve, reject) => {
        const { envelope, ctx } = secure.clientSeal(
          { method: "POST", url: "/api/auth/verify", headers: { "x-smartcook-locale": locale, "content-type": "application/json" }, body: "{}" },
          kp.publicKey
        );
        const data = JSON.stringify(envelope);
        const rq = http.request(
          { port: srv.address().port, path: "/api/secure", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
          (res) => {
            let b = "";
            res.on("data", (c) => (b += c));
            res.on("end", () => resolve(JSON.parse(secure.clientOpenResponse(JSON.parse(b), ctx).b)));
          }
        );
        rq.on("error", reject);
        rq.end(data);
      });
    try {
      assert.strictEqual((await call("en")).message, "Wrong code.");
      assert.strictEqual((await call("id")).message, "Kode OTP salah.");
    } finally {
      srv.close();
    }
  });

  console.log(`\n${pass} checks passed`);
})();
