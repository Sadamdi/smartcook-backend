"use strict";

/**
 * Short-lived proof that the holder just signed in with Google.
 *
 * Mirrors Kelilink's `googleTicket.ts`. The ticket is a JWT signed with a
 * key derived from `process.env.JWT_SECRET`, never with the secret itself,
 * so it can never pass as an access token. Audience is scoped to
 * `google-<purpose>` (e.g. `google-register`) so the same secret can't be
 * used to forge a ticket for another purpose.
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const TTL = "15m";

const SECRET_KEY = "smartcook:google-ticket";

const secretMissingError = () => {
  const e = new Error(
    "Google ticket tidak bisa dibuat/diverifikasi tanpa JWT_SECRET.",
  );
  e.statusCode = 500;
  e.code = "GOOGLE_TICKET_NOT_CONFIGURED";
  return e;
};

const key = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw secretMissingError();
  return crypto.createHmac("sha256", secret).update(SECRET_KEY).digest("hex");
};

const buildAudience = (purpose) => `google-${purpose}`;

/**
 * Sign a Google ticket for the given purpose + identity. Caller is expected
 * to have *already* verified the underlying Google ID token.
 *
 * @param {"register"|"link"} purpose
 * @param {{sub:string, email:string, name?:string, picture?:string}} data
 * @returns {string} signed JWT
 */
const signGoogleTicket = (purpose, data) => {
  if (purpose !== "register" && purpose !== "link") {
    const e = new Error(`Tujuan ticket Google tidak dikenal: ${purpose}`);
    e.statusCode = 400;
    e.code = "INVALID_GOOGLE_TICKET_PURPOSE";
    throw e;
  }
  if (!data || !data.sub || !data.email) {
    const e = new Error("Google ticket membutuhkan sub dan email.");
    e.statusCode = 400;
    e.code = "INVALID_GOOGLE_TICKET_PAYLOAD";
    throw e;
  }
  return jwt.sign(
    {
      sub: data.sub,
      email: data.email,
      name: data.name,
      picture: data.picture,
      purpose,
    },
    key(),
    { expiresIn: TTL, audience: buildAudience(purpose) },
  );
};

/**
 * Verify a Google ticket. Throws an Error with `statusCode` set so the
 * HTTP layer can map it. Refuses to accept anything when JWT_SECRET is
 * missing (we can't sign-verify safely without it).
 */
const verifyGoogleTicket = (purpose, token) => {
  if (purpose !== "register" && purpose !== "link") {
    const e = new Error(`Tujuan ticket Google tidak dikenal: ${purpose}`);
    e.statusCode = 400;
    e.code = "INVALID_GOOGLE_TICKET_PURPOSE";
    throw e;
  }
  if (!token || typeof token !== "string") {
    const e = new Error("Google ticket wajib diisi.");
    e.statusCode = 401;
    e.code = "INVALID_GOOGLE_TICKET";
    throw e;
  }

  let payload;
  try {
    payload = jwt.verify(token, key(), {
      audience: buildAudience(purpose),
    });
  } catch (err) {
    const e = new Error(
      "Sesi Google sudah kedaluwarsa atau tidak valid. Tekan tombol Google sekali lagi.",
    );
    e.statusCode = 401;
    e.code = "INVALID_GOOGLE_TICKET";
    throw e;
  }

  if (
    !payload ||
    payload.purpose !== purpose ||
    !payload.sub ||
    !payload.email
  ) {
    const e = new Error("Google ticket tidak valid.");
    e.statusCode = 401;
    e.code = "INVALID_GOOGLE_TICKET";
    throw e;
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };
};

module.exports = {
  signGoogleTicket,
  verifyGoogleTicket,
  TTL,
};
