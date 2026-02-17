const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  getProfile,
  updateProfile,
  saveOnboarding,
  sendPasswordChangeOTP,
  changePasswordFromProfile,
  sendEmailChangeOTP,
  confirmEmailChange,
} = require("../controllers/userController");

router.get("/profile", protect, getProfile);
router.put("/profile", protect, updateProfile);
router.put("/onboarding", protect, saveOnboarding);
router.post("/password/send-otp", protect, sendPasswordChangeOTP);
router.post("/password/change", protect, changePasswordFromProfile);
router.post("/email/send-otp", protect, sendEmailChangeOTP);
router.post("/email/confirm", protect, confirmEmailChange);

module.exports = router;
