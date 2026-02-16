const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { admin, initFirebase } = require("../config/firebase");
const { generateOTP, isOTPValid, getOTPExpiry } = require("../utils/otp");
const { sendOTPEmail } = require("../utils/email");

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email dan password wajib diisi." });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password minimal 6 karakter." });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email sudah terdaftar." });
    }

    const user = await User.create({
      name: name || "",
      email: email.toLowerCase(),
      password,
      auth_provider: "email",
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: "Registrasi berhasil.",
      data: { user, token },
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email dan password wajib diisi." });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) {
      return res.status(401).json({ success: false, message: "Email atau password salah." });
    }

    if (!user.password) {
      return res.status(401).json({
        success: false,
        message: "Akun ini terdaftar melalui Google. Silakan login dengan metode tersebut.",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Email atau password salah." });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: "Login berhasil.",
      data: { user, token },
    });
  } catch (error) {
    next(error);
  }
};

const googleAuth = async (req, res, next) => {
  try {
    const { id_token } = req.body;

    if (!id_token) {
      return res.status(400).json({ success: false, message: "ID token wajib dikirim." });
    }

    initFirebase();
    const decodedToken = await admin.auth().verifyIdToken(id_token);
    const { email, name, uid } = decodedToken;

    let user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      user = await User.create({
        email: email.toLowerCase(),
        name: name || "",
        auth_provider: "google",
        firebase_uid: uid,
      });
    } else {
      if (!user.firebase_uid) {
        user.firebase_uid = uid;
        await user.save();
      }
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: "Login Google berhasil.",
      data: { user, token },
    });
  } catch (error) {
    if (error.code === "auth/id-token-expired") {
      return res.status(401).json({ success: false, message: "Google token sudah expired." });
    }
    next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email wajib diisi." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ success: false, message: "Email tidak ditemukan." });
    }

    if (user.auth_provider !== "email") {
      return res.status(400).json({
        success: false,
        message: `Akun ini terdaftar melalui ${user.auth_provider}. Reset password tidak tersedia.`,
      });
    }

    const otp = generateOTP();
    user.otp_code = otp;
    user.otp_expires = getOTPExpiry();
    await user.save();

    await sendOTPEmail(email, otp);

    res.json({
      success: true,
      message: "Kode OTP telah dikirim ke email kamu.",
    });
  } catch (error) {
    next(error);
  }
};

const verifyOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email dan OTP wajib diisi." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ success: false, message: "Email tidak ditemukan." });
    }

    if (!isOTPValid(user)) {
      return res.status(400).json({ success: false, message: "Kode OTP sudah expired. Silakan minta ulang." });
    }

    if (user.otp_code !== otp) {
      return res.status(400).json({ success: false, message: "Kode OTP salah." });
    }

    res.json({
      success: true,
      message: "OTP terverifikasi.",
    });
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, new_password } = req.body;

    if (!email || !otp || !new_password) {
      return res.status(400).json({ success: false, message: "Email, OTP, dan password baru wajib diisi." });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ success: false, message: "Password minimal 6 karakter." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ success: false, message: "Email tidak ditemukan." });
    }

    if (!isOTPValid(user) || user.otp_code !== otp) {
      return res.status(400).json({ success: false, message: "Kode OTP tidak valid atau sudah expired." });
    }

    user.password = new_password;
    user.otp_code = null;
    user.otp_expires = null;
    await user.save();

    res.json({
      success: true,
      message: "Password berhasil direset.",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  googleAuth,
  forgotPassword,
  verifyOTP,
  resetPassword,
};
