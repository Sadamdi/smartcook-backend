"use strict";

/**
 * OTP send-rate helpers, shared by the auth and profile controllers.
 *
 * These lived inside authController.js only, so userController.js called them
 * without ever importing them - `/api/user/password/send-otp` and
 * `/api/user/email/send-otp` both threw ReferenceError on first use.
 */

const ONE_MINUTE_MS = 60 * 1000;

/** Seconds left before the user may request another OTP. */
function checkOtpSendRateLimit(user) {
  const now = new Date();
  if (!user.otp_last_sent_at) return { limited: false };
  const last = new Date(user.otp_last_sent_at).getTime();
  const diff = now.getTime() - last;
  if (diff < ONE_MINUTE_MS) {
    const secondsLeft = Math.ceil((ONE_MINUTE_MS - diff) / 1000);
    return { limited: true, secondsLeft };
  }
  return { limited: false };
}

function markOtpSent(user) {
  user.otp_last_sent_at = new Date();
}

function getOtpExpirySeconds(user) {
  if (!user.otp_expires) return null;
  const diff = new Date(user.otp_expires).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 1000);
}

module.exports = { checkOtpSendRateLimit, markOtpSent, getOtpExpirySeconds };
