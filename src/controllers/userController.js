const User = require("../models/User");
const DevLog = require("../modules/devlog/model");
const FridgeItem = require("../models/FridgeItem");
const Favorite = require("../models/Favorite");
const ChatHistory = require("../models/ChatHistory");
const Recipe = require("../models/Recipe");
const { generateOTP, isOTPValid, getOTPExpiry, otpMatches } = require("../utils/otp");
const { sendOTPEmail } = require("../utils/email");
const { logEvent, buildRequestContext } = require("../utils/logger");
const {
  checkOtpSendRateLimit,
  markOtpSent,
  getOtpExpirySeconds,
} = require("../utils/otpRateLimit");

const getProfile = async (req, res, next) => {
  try {
    const ctx = buildRequestContext(req);
    logEvent("profile_get", {
      ...ctx,
      success: true,
      statusCode: 200,
    });
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

    const ctx = buildRequestContext(req);
    logEvent("profile_update", {
      ...ctx,
      success: true,
      statusCode: 200,
      updatedFields: Object.keys(updates),
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

    const ctx = buildRequestContext(req);
    logEvent("onboarding_save", {
      ...ctx,
      success: true,
      statusCode: 200,
      hasAllergies: Array.isArray(allergies) && allergies.length > 0,
      hasMedicalHistory:
        Array.isArray(medical_history) && medical_history.length > 0,
      hasCookingStyles:
        Array.isArray(cooking_styles) && cooking_styles.length > 0,
      hasEquipment: Array.isArray(equipment) && equipment.length > 0,
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

const sendPasswordChangeOTP = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      const ctx = buildRequestContext(req);
      logEvent("profile_password_otp_send", {
        ...ctx,
        success: false,
        statusCode: 404,
        reason: "user_not_found",
      });
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan." });
    }

    const rate = checkOtpSendRateLimit(user);
    if (rate.limited) {
      const retryAfter = rate.secondsLeft || 60;
      const ctx = buildRequestContext(req);
      logEvent("profile_password_otp_send", {
        ...ctx,
        success: false,
        statusCode: 429,
        reason: "otp_send_rate_limited",
        retryAfterSeconds: retryAfter,
      });
      return res.status(429).json({
        success: false,
        code: "OTP_SEND_RATE_LIMIT",
        message: `Terlalu sering meminta OTP. Coba lagi dalam ${retryAfter} detik.`,
        retry_after_seconds: retryAfter,
        expires_in_seconds: getOtpExpirySeconds(user),
      });
    }

    const otp = generateOTP();
    user.otp_code = otp;
    markOtpSent(user);
    await user.save();

    await sendOTPEmail(user.email, otp, {
      purpose: "change-password",
      name: user.name,
    });

    const ctx = buildRequestContext(req);
    logEvent("profile_password_otp_send", {
      ...ctx,
      success: true,
      statusCode: 200,
      email: user.email,
    });

    const expiresIn = getOtpExpirySeconds(user);

    res.json({
      success: true,
      message: "Kode OTP untuk ganti password telah dikirim ke email kamu.",
      data: {
        expires_in_seconds: expiresIn,
      },
    });
  } catch (error) {
    next(error);
  }
};

const changePasswordFromProfile = async (req, res, next) => {
  try {
    const { current_password, otp, new_password } = req.body;

    if (!new_password || new_password.length < 6) {
      const ctx = buildRequestContext(req);
      logEvent("profile_password_change", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "password_too_short",
      });
      return res.status(400).json({
        success: false,
        message: "Password baru minimal 6 karakter.",
      });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      const ctx = buildRequestContext(req);
      logEvent("profile_password_change", {
        ...ctx,
        success: false,
        statusCode: 404,
        reason: "user_not_found",
      });
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan." });
    }

    if (!current_password && !otp) {
      const ctx = buildRequestContext(req);
      logEvent("profile_password_change", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "missing_current_or_otp",
      });
      return res.status(400).json({
        success: false,
        message: "Harus mengirimkan password lama atau OTP.",
      });
    }

    if (current_password) {
      const ok = await user.comparePassword(current_password);
      if (!ok) {
        const ctx = buildRequestContext(req);
        logEvent("profile_password_change", {
          ...ctx,
          success: false,
          statusCode: 400,
          reason: "current_password_mismatch",
        });
        return res.status(400).json({
          success: false,
          message: "Password lama tidak cocok.",
        });
      }
    } else if (otp) {
      if (!isOTPValid(user) || !(await otpMatches(user, otp))) {
        const ctx = buildRequestContext(req);
        logEvent("profile_password_change", {
          ...ctx,
          success: false,
          statusCode: 400,
          reason: "otp_invalid",
        });
        return res.status(400).json({
          success: false,
          message: "Kode OTP tidak valid atau sudah expired.",
        });
      }
    }

    user.password = new_password;
    user.otp_code = null;
    user.otp_expires = null;
    await user.save();

    const ctx = buildRequestContext(req);
    logEvent("profile_password_change", {
      ...ctx,
      success: true,
      statusCode: 200,
      email: user.email,
    });

    res.json({
      success: true,
      message: "Password berhasil diubah.",
      data: user.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

const sendEmailChangeOTP = async (req, res, next) => {
  try {
    const { new_email } = req.body;

    if (!new_email) {
      const ctx = buildRequestContext(req);
      logEvent("profile_email_otp_send", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "missing_new_email",
      });
      return res
        .status(400)
        .json({ success: false, message: "Email baru wajib diisi." });
    }

    const normalized = new_email.toLowerCase();

    if (normalized === req.user.email) {
      const ctx = buildRequestContext(req);
      logEvent("profile_email_otp_send", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "same_email",
        email: normalized,
      });
      return res.status(400).json({
        success: false,
        message: "Email baru tidak boleh sama dengan email lama.",
      });
    }

    const existing = await User.findOne({ email: normalized });
    if (existing && existing._id.toString() !== req.user._id.toString()) {
      const ctx = buildRequestContext(req);
      logEvent("profile_email_otp_send", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "email_taken",
        email: normalized,
      });
      return res.status(400).json({
        success: false,
        message: "Email sudah digunakan oleh akun lain.",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      const ctx = buildRequestContext(req);
      logEvent("profile_email_otp_send", {
        ...ctx,
        success: false,
        statusCode: 404,
        reason: "user_not_found",
      });
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan." });
    }

    const rate = checkOtpSendRateLimit(user);
    if (rate.limited) {
      const retryAfter = rate.secondsLeft || 60;
      const ctx = buildRequestContext(req);
      logEvent("profile_email_otp_send", {
        ...ctx,
        success: false,
        statusCode: 429,
        reason: "otp_send_rate_limited",
        retryAfterSeconds: retryAfter,
      });
      return res.status(429).json({
        success: false,
        code: "OTP_SEND_RATE_LIMIT",
        message: `Terlalu sering meminta OTP. Coba lagi dalam ${retryAfter} detik.`,
        retry_after_seconds: retryAfter,
        expires_in_seconds: getOtpExpirySeconds(user),
      });
    }

    const otp = generateOTP();
    user.pending_email = normalized;
    user.otp_code = otp;
    markOtpSent(user);
    await user.save();

    await sendOTPEmail(user.email, otp, {
      purpose: "change-email",
      name: user.name,
    });

    const ctx = buildRequestContext(req);
    logEvent("profile_email_otp_send", {
      ...ctx,
      success: true,
      statusCode: 200,
      email: normalized,
    });

    const expiresIn = getOtpExpirySeconds(user);

    res.json({
      success: true,
      message:
        "Kode OTP untuk ganti email telah dikirim ke email kamu. Masukkan kode tersebut untuk konfirmasi.",
      data: {
        expires_in_seconds: expiresIn,
      },
    });
  } catch (error) {
    next(error);
  }
};

const confirmEmailChange = async (req, res, next) => {
  try {
    const { otp } = req.body;

    if (!otp) {
      const ctx = buildRequestContext(req);
      logEvent("profile_email_change", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "missing_otp",
      });
      return res
        .status(400)
        .json({ success: false, message: "Kode OTP wajib diisi." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      const ctx = buildRequestContext(req);
      logEvent("profile_email_change", {
        ...ctx,
        success: false,
        statusCode: 404,
        reason: "user_not_found",
      });
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan." });
    }

    if (!user.pending_email) {
      const ctx = buildRequestContext(req);
      logEvent("profile_email_change", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "no_pending_email",
      });
      return res.status(400).json({
        success: false,
        message: "Tidak ada permintaan ganti email yang aktif.",
      });
    }

    if (!isOTPValid(user) || !(await otpMatches(user, otp))) {
      const ctx = buildRequestContext(req);
      logEvent("profile_email_change", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "otp_invalid",
      });
      return res.status(400).json({
        success: false,
        message: "Kode OTP tidak valid atau sudah expired.",
      });
    }

    const existing = await User.findOne({ email: user.pending_email });
    if (existing && existing._id.toString() !== user._id.toString()) {
      const ctx = buildRequestContext(req);
      logEvent("profile_email_change", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "email_taken",
        email: user.pending_email,
      });
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

    const ctx = buildRequestContext(req);
    logEvent("profile_email_change", {
      ...ctx,
      success: true,
      statusCode: 200,
      email: user.email,
    });

    res.json({
      success: true,
      message: "Email berhasil diubah.",
      data: user.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Step 1 of account deletion: mail a single-purpose OTP.
 *
 * The code authorises the delete and nothing else, so it can never be
 * replayed from an email that was phished. Same 60-second cooldown as the
 * other OTP sends so the endpoint cannot be used to spam a mailbox.
 */
const sendDeleteAccountOTP = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      const ctx = buildRequestContext(req);
      logEvent("account_delete_otp_send", {
        ...ctx,
        success: false,
        statusCode: 404,
        reason: "user_not_found",
      });
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan." });
    }

    if (!user.email) {
      // Without an email there is nowhere to send the code, and falling back
      // to the password would be a weaker proof of ownership.
      const ctx = buildRequestContext(req);
      logEvent("account_delete_otp_send", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "no_email",
      });
      return res.status(400).json({
        success: false,
        code: "NO_EMAIL",
        message:
          "Akun ini belum punya email, jadi kode konfirmasi tidak bisa dikirim. Tambahkan email dulu di Profil.",
      });
    }

    const rate = checkOtpSendRateLimit(user);
    if (rate.limited) {
      const retryAfter = rate.secondsLeft || 60;
      const ctx = buildRequestContext(req);
      logEvent("account_delete_otp_send", {
        ...ctx,
        success: false,
        statusCode: 429,
        reason: "otp_send_rate_limited",
        retryAfterSeconds: retryAfter,
      });
      return res.status(429).json({
        success: false,
        code: "OTP_SEND_RATE_LIMIT",
        message: `Terlalu sering meminta kode. Coba lagi dalam ${retryAfter} detik.`,
        retry_after_seconds: retryAfter,
        expires_in_seconds: getOtpExpirySeconds(user),
      });
    }

    const otp = generateOTP();
    user.otp_code = otp;
    markOtpSent(user);
    user.otp_expires = getOTPExpiry();
    await user.save();

    await sendOTPEmail(user.email, otp, {
      purpose: "delete-account",
      name: user.name,
    });

    const ctx = buildRequestContext(req);
    logEvent("account_delete_otp_send", {
      ...ctx,
      success: true,
      statusCode: 200,
    });

    res.json({
      success: true,
      message: "Kode konfirmasi telah dikirim ke email kamu.",
      data: { expires_in_seconds: getOtpExpirySeconds(user) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Step 2: exchange the OTP for permanent deletion.
 *
 * Hard delete, per product decision: the account and everything owned by it
 * (fridge, favourites, chat history) is removed. AI-generated recipes are
 * kept but detached - other users may already have saved them, so dropping
 * them would destroy someone else's data.
 */
const deleteAccount = async (req, res, next) => {
  try {
    const { otp } = req.body || {};

    if (!otp) {
      const ctx = buildRequestContext(req);
      logEvent("account_delete", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "missing_otp",
      });
      return res
        .status(400)
        .json({ success: false, message: "Kode OTP wajib diisi." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      const ctx = buildRequestContext(req);
      logEvent("account_delete", {
        ...ctx,
        success: false,
        statusCode: 404,
        reason: "user_not_found",
      });
      return res
        .status(404)
        .json({ success: false, message: "User tidak ditemukan." });
    }

    if (!isOTPValid(user)) {
      const ctx = buildRequestContext(req);
      logEvent("account_delete", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "otp_invalid_or_expired",
      });
      return res.status(400).json({
        success: false,
        code: "OTP_INVALID",
        message: "Kode salah atau sudah kedaluwarsa. Minta kode baru.",
      });
    }

    if (!(await otpMatches(user, otp))) {
      const ctx = buildRequestContext(req);
      logEvent("account_delete", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "otp_mismatch",
      });
      return res.status(400).json({
        success: false,
        code: "OTP_INVALID",
        message: "Kode salah atau sudah kedaluwarsa. Minta kode baru.",
      });
    }

    const uid = user._id;
    const [fridge, favourites, chat, recipesDetached] = await Promise.all([
      FridgeItem.deleteMany({ user_id: uid }),
      Favorite.deleteMany({ user_id: uid }),
      ChatHistory.deleteMany({ user_id: uid }),
      Recipe.updateMany({ created_by: uid }, { $set: { created_by: null } }),
      // Developer-log rows tagged with this account go too, not at the 30-day
      // expiry: deleting an account must remove what we hold about the person.
      DevLog.deleteMany({ userId: String(uid) }),
    ]);

    // Clear the OTP before the delete: if `remove` fails for any reason the
    // code must not stay usable.
    user.otp_code = null;
    user.otp_expires = null;
    user.pending_email = null;
    await User.deleteOne({ _id: uid });

    const ctx = buildRequestContext(req);
    logEvent("account_delete", {
      ...ctx,
      success: true,
      statusCode: 200,
      deleted: {
        fridge: fridge.deletedCount || 0,
        favourites: favourites.deletedCount || 0,
        chat: chat.deletedCount || 0,
        recipesDetached: recipesDetached.modifiedCount || 0,
      },
    });

    res.json({
      success: true,
      message: "Akun kamu telah dihapus.",
      data: {
        fridge: fridge.deletedCount || 0,
        favourites: favourites.deletedCount || 0,
        chat: chat.deletedCount || 0,
      },
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
  sendDeleteAccountOTP,
  deleteAccount,
};
