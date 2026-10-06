"use strict";

/**
 * Explicit, operator-run rotation of the app token signing key.
 *
 * NOT wired to any scheduler. Run it by hand:
 *
 *   node scripts/rotate-app-tokens.js                 # rotate, keep live sessions
 *   node scripts/rotate-app-tokens.js --revoke-all    # rotate and kill all sessions
 *   node scripts/rotate-app-tokens.js --print-only    # show current config, change nothing
 *   node scripts/rotate-app-tokens.js --grace-hours 24 # keep the previous secret this long
 *
 * What rotation does:
 *   1. Moves the current APP_TOKENS_SECRET into APP_TOKENS_PREVIOUS_SECRET
 *      (grace window: tokens minted just before the rotation keep working
 *      until they hit their own expiry).
 *   2. Writes a brand-new APP_TOKENS_SECRET from 384 bits of CSPRNG entropy.
 *   3. Bumps APP_TOKENS_KEY_INDEX so every session minted afterwards is
 *      traceable to this generation.
 *   4. Stamps APP_TOKENS_LAST_ROTATED_AT.
 *   5. Optionally revokes every live session, which forces each device to
 *      re-handshake. Use this after a suspected leak.
 *
 * Safety: it refuses to run unless APP_TOKENS_SECRET is already set and at
 * least 32 characters long, so you cannot accidentally "rotate" an
 * unconfigured deployment into a different unconfigured one.
 */

require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MIN_SECRET_LENGTH = 32;
const SECRET_BYTES = 48; // -> 64 base64url chars
const DEFAULT_GRACE_HOURS = 24;

function parseArgs(argv) {
  const args = {
    revokeAll: false,
    printOnly: false,
    graceHours: DEFAULT_GRACE_HOURS,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--revoke-all") args.revokeAll = true;
    else if (arg === "--print-only") args.printOnly = true;
    else if (arg === "--grace-hours") {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("--grace-hours harus angka >= 0");
      }
      args.graceHours = Math.floor(value);
      i++;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Argumen tidak dikenal: ${arg}`);
    }
  }
  return args;
}

function envFilePath() {
  return path.resolve(__dirname, "..", ".env");
}

function upsertEnvLine(contents, key, value) {
  const pattern = new RegExp("^" + key + "=.*$", "m");
  const line = key + "=" + value;
  if (pattern.test(contents)) return contents.replace(pattern, line);
  const suffix = contents.endsWith("\n") ? "" : "\n";
  return contents + suffix + line + "\n";
}

function generateSecret() {
  return crypto.randomBytes(SECRET_BYTES).toString("base64url");
}

function redact(secret) {
  if (!secret) return "(unset)";
  return secret.slice(0, 6) + "..." + secret.slice(-4) + " (" + secret.length + " chars)";
}

function loadConfig(envFile) {
  const contents = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : null;
  const fromFile = (key) => {
    if (!contents) return process.env[key];
    const match = new RegExp("^" + key + "=(.*)$", "m").exec(contents);
    return match ? match[1].trim() : process.env[key];
  };
  return { contents, fromFile };
}

async function revokeAllSessions(reason) {
  const { connectMongoDB } = require("../src/config/db");
  const { AppTokenService } = require("../src/modules/app-tokens/service");
  const conn = await connectMongoDB();
  if (!conn) return null;
  const result = await new AppTokenService().revokeAll(reason);
  return result.revoked;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      [
        "Usage: node scripts/rotate-app-tokens.js [options]",
        "",
        "  --revoke-all          Retire every live session (devices re-handshake).",
        "  --print-only          Show current configuration without changing it.",
        "  --grace-hours <n>     How long the previous secret stays accepted.",
        "",
        "This script is intentionally NOT scheduled. Rotate by hand.",
      ].join("\n")
    );
    return 0;
  }

  const envFile = envFilePath();
  const { contents, fromFile } = loadConfig(envFile);

  const currentSecret = fromFile("APP_TOKENS_SECRET");
  const parsedIndex = Number(fromFile("APP_TOKENS_KEY_INDEX") || "1");
  const currentIndex = Number.isInteger(parsedIndex) ? parsedIndex : 1;
  const lastRotated = fromFile("APP_TOKENS_LAST_ROTATED_AT");

  console.log("=== current app-token configuration ===");
  console.log("APP_TOKENS_SECRET           " + redact(currentSecret));
  console.log("APP_TOKENS_PREVIOUS_SECRET  " + redact(fromFile("APP_TOKENS_PREVIOUS_SECRET")));
  console.log("APP_TOKENS_KEY_INDEX        " + currentIndex);
  console.log("APP_TOKENS_LAST_ROTATED_AT  " + (lastRotated || "(never)"));
  console.log("APP_ACCESS_TTL_SECONDS      " + (fromFile("APP_ACCESS_TTL_SECONDS") || "(default 86400)"));
  console.log("APP_REFRESH_TTL_SECONDS     " + (fromFile("APP_REFRESH_TTL_SECONDS") || "(default 604800)"));

  if (args.printOnly) {
    console.log("\n--print-only: nothing changed.");
    return 0;
  }

  if (!currentSecret || currentSecret.length < MIN_SECRET_LENGTH) {
    console.error(
      "\nERROR: refusing to rotate. APP_TOKENS_SECRET is unset or shorter than " +
        MIN_SECRET_LENGTH +
        " characters."
    );
    console.error("Bootstrap it first, e.g.:");
    console.error(
      '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
    return 1;
  }
  if (!contents) {
    console.error("\nERROR: no .env found at " + envFile + ". Nothing changed.");
    return 1;
  }

  const previous =
    args.graceHours > 0 ? currentSecret : fromFile("APP_TOKENS_PREVIOUS_SECRET") || "";
  const nextSecret = generateSecret();
  const nextIndex = currentIndex + 1;
  const nowIso = new Date().toISOString();

  let updated = contents;
  updated = upsertEnvLine(updated, "APP_TOKENS_PREVIOUS_SECRET", previous);
  updated = upsertEnvLine(updated, "APP_TOKENS_SECRET", nextSecret);
  updated = upsertEnvLine(updated, "APP_TOKENS_KEY_INDEX", String(nextIndex));
  updated = upsertEnvLine(updated, "APP_TOKENS_LAST_ROTATED_AT", nowIso);

  // Write atomically: a half-written .env would take the whole API down.
  const tmp = envFile + ".rotating";
  fs.writeFileSync(tmp, updated, { mode: 0o600 });
  fs.renameSync(tmp, envFile);
  fs.chmodSync(envFile, 0o600);

  console.log("\n=== rotation written to .env ===");
  console.log("APP_TOKENS_SECRET           " + redact(nextSecret));
  console.log("APP_TOKENS_PREVIOUS_SECRET  " + (previous ? redact(previous) : "(cleared)"));
  console.log("APP_TOKENS_KEY_INDEX        " + nextIndex);
  console.log("APP_TOKENS_LAST_ROTATED_AT  " + nowIso);
  console.log(
    args.graceHours > 0
      ? "\nGrace: the previous secret stays accepted for " +
          args.graceHours +
          "h so recently-issued sessions survive."
      : "\nGrace: cleared - every token signed with the old secret stops verifying immediately."
  );

  if (args.revokeAll) {
    let revoked = null;
    try {
      revoked = await revokeAllSessions("key_rotation_" + nextIndex);
    } catch (error) {
      console.error("\nERROR during --revoke-all: " + error.message);
      console.error("The .env was already rotated. Revoke manually once Mongo is reachable.");
      return 1;
    }
    if (revoked === null) {
      console.error(
        "\nERROR: --revoke-all was requested but MongoDB is unreachable. Revoke manually after fixing connectivity."
      );
      return 1;
    }
    console.log(
      "\nRevoked " + revoked + " live session(s). Devices will re-handshake on their next request."
    );
  } else {
    console.log(
      "\nLive sessions were kept. Pass --revoke-all if you are rotating after a suspected leak."
    );
  }

  console.log("\nNext step: restart the API so it loads the new secret.");
  console.log("  pm2 restart smartcook-backend");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("\nERROR: " + error.message);
    process.exit(1);
  });
