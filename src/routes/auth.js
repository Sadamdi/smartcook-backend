const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const {
	register,
	login,
	googleAuth,
	forgotPassword,
	verifyOTP,
	resetPassword,
	setGooglePassword,
	loginOTPVerify,
	loginOTPResend,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// 30/hour/IP cap on Google sign-in & the follow-up set-password endpoint so
// an offline attacker can't drain the verifyIdToken quota. Single device
// retries on a flaky network still work comfortably under this budget.
const googleLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 30,
	standardHeaders: true,
	legacyHeaders: false,
	handler: (req, res) => {
		res.status(429).json({
			success: false,
			message: 'Terlalu banyak percobaan sign-in Google. Coba lagi nanti.',
		});
	},
});

router.post('/register', register);
router.post('/login', login);
router.post('/google', googleLimiter, googleAuth);
router.post('/google/set-password', protect, setGooglePassword);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);
router.post('/login-otp-verify', loginOTPVerify);
router.post('/login-otp-resend', loginOTPResend);

module.exports = router;
