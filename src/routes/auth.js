const express = require('express');
const router = express.Router();
const {
	register,
	login,
	googleAuth,
	forgotPassword,
	verifyOTP,
	resetPassword,
	setGooglePassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/google', googleAuth);
router.post('/google/set-password', protect, setGooglePassword);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

module.exports = router;
