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

// App-level (not user-level) auth: handshake / refresh / revoke. Mounted here
// so they live next to the other auth endpoints, but they are unauthenticated
// on purpose — they are how a device bootstraps and renews its own token.
const appTokenRoutes = require('../modules/app-tokens/routes');

router.post('/register', register);
router.post('/login', login);
router.post('/google', googleLimiter, googleAuth);
router.post('/google/set-password', protect, setGooglePassword);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);
router.post('/login-otp-verify', loginOTPVerify);
router.post('/login-otp-resend', loginOTPResend);

// Handshake / refresh / revoke. These carry their own rate limits and their
// own cert gate, so they must be registered before any router-level gate.
router.use('/', appTokenRoutes);

module.exports = router;
