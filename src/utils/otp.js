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

module.exports = { generateOTP, isOTPValid, getOTPExpiry };
