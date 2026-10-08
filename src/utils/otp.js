const crypto = require("crypto");

const generateOTP = () => {
  return crypto.randomInt(1000, 9999).toString();
};

const isOTPValid = (user) => {
  if (!user.otp_code || !user.otp_expires) return false;
  return new Date() < new Date(user.otp_expires);
};

const getOTPExpiry = () => {
  return new Date(Date.now() + 10 * 60 * 1000);
};

const MAX_OTP_ATTEMPTS = 5;

/**
 * Checks a submitted OTP in constant time and counts wrong guesses. After
 * MAX_OTP_ATTEMPTS misses the code is burned, so the user has to request a
 * new one; a 4-digit code cannot be brute-forced within its lifetime.
 */
const otpMatches = async (user, submitted) => {
  const expected = user.otp_code == null ? "" : String(user.otp_code);
  const given = String(submitted == null ? "" : submitted).trim();
  if (
    expected.length > 0 &&
    expected.length === given.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))
  ) {
    return true;
  }

  const attempts = (user.otp_failed_attempts || 0) + 1;
  const burn = attempts >= MAX_OTP_ATTEMPTS;
  const update = burn
    ? { $inc: { otp_failed_attempts: 1 }, $set: { otp_code: null, otp_expires: null } }
    : { $inc: { otp_failed_attempts: 1 } };
  await user.constructor.updateOne({ _id: user._id }, update);
  user.otp_failed_attempts = attempts;
  if (burn) {
    user.otp_code = null;
    user.otp_expires = null;
  }
  return false;
};

module.exports = { generateOTP, isOTPValid, getOTPExpiry, otpMatches, MAX_OTP_ATTEMPTS };
