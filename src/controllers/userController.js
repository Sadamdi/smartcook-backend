const User = require("../models/User");
const { generateOTP, isOTPValid, getOTPExpiry } = require("../utils/otp");
const { sendOTPEmail } = require("../utils/email");

const getProfile = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: req.user,
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = ["name", "age_range", "gender"];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Profil berhasil diupdate.",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

const saveOnboarding = async (req, res, next) => {
  try {
    const {
      name,
      age_range,
      gender,
      allergies,
      medical_history,
      cooking_styles,
      equipment,
    } = req.body;

    const updates = { onboarding_completed: true };

    if (name !== undefined) updates.name = name;
    if (age_range !== undefined) updates.age_range = age_range;
    if (gender !== undefined) updates.gender = gender;
    if (allergies !== undefined) updates.allergies = allergies;
    if (medical_history !== undefined) updates.medical_history = medical_history;
    if (cooking_styles !== undefined) updates.cooking_styles = cooking_styles;
    if (equipment !== undefined) updates.equipment = equipment;

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Data onboarding berhasil disimpan.",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

// Kirim OTP ke email user untuk perubahan password (opsi tanpa input password lama).
const sendPasswordChangeOTP = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan." });
    }

    const otp = generateOTP();
    user.otp_code = otp;
    user.otp_expires = getOTPExpiry();
    await user.save();

    await sendOTPEmail(user.email, otp);

    res.json({
      success: true,
      message: "Kode OTP untuk ganti password telah dikirim ke email kamu.",
    });
  } catch (error) {
    next(error);
  }
};

// Ganti password dari halaman profil.
// Bisa pakai password lama ATAU OTP (yang dikirim lewat sendPasswordChangeOTP).
const changePasswordFromProfile = async (req, res, next) => {
  try {
    const { current_password, otp, new_password } = req.body;

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password baru minimal 6 karakter.",
      });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan." });
    }

    if (!current_password && !otp) {
      return res.status(400).json({
        success: false,
        message: "Harus mengirimkan password lama atau OTP.",
      });
    }

    // Opsi 1: verifikasi pakai password lama
    if (current_password) {
      const ok = await user.comparePassword(current_password);
      if (!ok) {
        return res.status(400).json({
          success: false,
          message: "Password lama tidak cocok.",
        });
      }
    } else if (otp) {
      // Opsi 2: verifikasi pakai OTP
      if (!isOTPValid(user) || user.otp_code !== otp) {
        return res.status(400).json({
          success: false,
          message: "Kode OTP tidak valid atau sudah expired.",
        });
      }
    }

    user.password = new_password;
    // bersihkan OTP setelah dipakai
    user.otp_code = null;
    user.otp_expires = null;
    await user.save();

    res.json({
      success: true,
      message: "Password berhasil diubah.",
      data: user.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

// Kirim OTP untuk ganti email. OTP dikirim ke email lama, perubahan disimpan sementara.
const sendEmailChangeOTP = async (req, res, next) => {
  try {
    const { new_email } = req.body;

    if (!new_email) {
      return res
        .status(400)
        .json({ success: false, message: "Email baru wajib diisi." });
    }

    const normalized = new_email.toLowerCase();

    if (normalized === req.user.email) {
      return res.status(400).json({
        success: false,
        message: "Email baru tidak boleh sama dengan email lama.",
      });
    }

    const existing = await User.findOne({ email: normalized });
    if (existing && existing._id.toString() !== req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Email sudah digunakan oleh akun lain.",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan." });
    }

    const otp = generateOTP();
    user.pending_email = normalized;
    user.otp_code = otp;
    user.otp_expires = getOTPExpiry();
    await user.save();

    // Demi keamanan, kirim OTP ke email lama.
    await sendOTPEmail(user.email, otp);

    res.json({
      success: true,
      message:
        "Kode OTP untuk ganti email telah dikirim ke email kamu. Masukkan kode tersebut untuk konfirmasi.",
    });
  } catch (error) {
    next(error);
  }
};

// Konfirmasi ganti email dengan OTP.
const confirmEmailChange = async (req, res, next) => {
  try {
    const { otp } = req.body;

    if (!otp) {
      return res
        .status(400)
        .json({ success: false, message: "Kode OTP wajib diisi." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan." });
    }

    if (!user.pending_email) {
      return res.status(400).json({
        success: false,
        message: "Tidak ada permintaan ganti email yang aktif.",
      });
    }

    if (!isOTPValid(user) || user.otp_code !== otp) {
      return res.status(400).json({
        success: false,
        message: "Kode OTP tidak valid atau sudah expired.",
      });
    }

    // pastikan lagi email baru belum dipakai user lain
    const existing = await User.findOne({ email: user.pending_email });
    if (existing && existing._id.toString() !== user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Email baru sudah digunakan oleh akun lain.",
      });
    }

    user.email = user.pending_email;
    user.pending_email = null;
    user.otp_code = null;
    user.otp_expires = null;
    await user.save();

    res.json({
      success: true,
      message: "Email berhasil diubah.",
      data: user.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  saveOnboarding,
  sendPasswordChangeOTP,
  changePasswordFromProfile,
  sendEmailChangeOTP,
  confirmEmailChange,
};
