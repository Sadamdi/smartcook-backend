const express = require("express");
const router = express.Router();
const {
  register,
  login,
  googleAuth,
  forgotPassword,
  verifyOTP,
  resetPassword,
} = require("../controllers/authController");

router.post("/register", register);
router.post("/login", login);
router.post("/google", googleAuth);
router.post("/forgot-password", forgotPassword);
router.post("/verify-otp", verifyOTP);
router.post("/reset-password", resetPassword);

module.exports = router;
