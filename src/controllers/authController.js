const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { admin, initFirebase } = require("../config/firebase");
const { generateOTP, isOTPValid, getOTPExpiry } = require("../utils/otp");
const { sendOTPEmail } = require("../utils/email");
const { logEvent, buildRequestContext } = require("../utils/logger");

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

const getTodayDateOnly = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS_5_MIN = 5;
const MAX_ATTEMPTS_DAILY = 10;
const ONE_MINUTE_MS = 60 * 1000;

// Rate limit tambahan berbasis IP untuk kasus email yang tidak ditemukan,
// supaya tetap ikut aturan 5x/5 menit dan 10x/hari.
const ipLoginState = new Map(); // key: ip, value: { failedAttempts, firstFailedAt, dailyFailed, dailyDate, lockedUntil }

const buildLoginLimitResponse = (res, { code, message, status = 400, extra = {} }) => {
  return res.status(status).json({
    success: false,
    code,
    message,
    ...extra,
  });
};

const checkAndUpdateLoginRateLimit = (user, { isFailedAttempt }) => {
  const now = new Date();
  const today = getTodayDateOnly();

  // Reset daily counter jika hari berubah
  if (!user.login_daily_date || user.login_daily_date.toDateString() !== today.toDateString()) {
    user.login_daily_failed = 0;
    user.login_daily_date = today;
  }

  // Cek lock sampai waktu tertentu (mis. 5 menit)
  if (user.login_locked_until && user.login_locked_until > now) {
    const msLeft = user.login_locked_until.getTime() - now.getTime();
    const secondsLeft = Math.ceil(msLeft / 1000);
    return {
      limited: true,
      reason: "window_lock",
      secondsLeft,
    };
  }

  if (!isFailedAttempt) {
    // Jika bukan attempt gagal, cukup kembalikan info bahwa tidak limited
    return { limited: false };
  }

  // Inisialisasi window 5 menit pertama jika belum ada atau sudah lewat
  if (!user.login_first_failed_at || now - user.login_first_failed_at > FIVE_MINUTES_MS) {
    user.login_first_failed_at = now;
    user.login_failed_attempts = 0;
  }

  user.login_failed_attempts = (user.login_failed_attempts || 0) + 1;
  user.login_daily_failed = (user.login_daily_failed || 0) + 1;

  // Hitung apakah melewati limit 5x/5 menit
  if (user.login_failed_attempts >= MAX_ATTEMPTS_5_MIN && now - user.login_first_failed_at <= FIVE_MINUTES_MS) {
    user.login_locked_until = new Date(now.getTime() + FIVE_MINUTES_MS);
    const msLeft = user.login_locked_until.getTime() - now.getTime();
    const secondsLeft = Math.ceil(msLeft / 1000);
    return {
      limited: true,
      reason: "5min_limit",
      secondsLeft,
    };
  }

  // Cek limit harian 10x
  if (user.login_daily_failed >= MAX_ATTEMPTS_DAILY) {
    return {
      limited: true,
      reason: "daily_limit",
    };
  }

  return { limited: false };
};

const resetLoginRateLimitCounters = (user) => {
  const today = getTodayDateOnly();
  user.login_failed_attempts = 0;
  user.login_first_failed_at = null;
  user.login_daily_failed = 0;
  user.login_daily_date = today;
  user.login_locked_until = null;
};

const getOtpExpirySeconds = (user) => {
  if (!user.otp_expires) return null;
  const now = Date.now();
  const diff = user.otp_expires.getTime() - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / 1000);
};

const checkOtpSendRateLimit = (user) => {
  const now = Date.now();
  if (!user.otp_last_sent_at) return { limited: false };
  const last = user.otp_last_sent_at.getTime();
  const diff = now - last;
  if (diff < ONE_MINUTE_MS) {
    const msLeft = ONE_MINUTE_MS - diff;
    const secondsLeft = Math.ceil(msLeft / 1000);
    return { limited: true, secondsLeft };
  }
  return { limited: false };
};

const markOtpSent = (user) => {
  user.otp_last_sent_at = new Date();
  user.otp_expires = getOTPExpiry();
};

const checkAndUpdateIpRateLimitForUnknownEmail = (ip, { isFailedAttempt }) => {
  const now = new Date();
  const today = getTodayDateOnly();

  let state = ipLoginState.get(ip);
  if (!state) {
    state = {
      failedAttempts: 0,
      firstFailedAt: null,
      dailyFailed: 0,
      dailyDate: today,
      lockedUntil: null,
    };
  }

  // Reset daily counter jika hari berubah
  if (!state.dailyDate || state.dailyDate.toDateString() !== today.toDateString()) {
    state.dailyFailed = 0;
    state.dailyDate = today;
  }

  // Cek lock window 5 menit
  if (state.lockedUntil && state.lockedUntil > now) {
    const msLeft = state.lockedUntil.getTime() - now.getTime();
    const secondsLeft = Math.ceil(msLeft / 1000);
    ipLoginState.set(ip, state);
    return {
      limited: true,
      reason: "window_lock",
      secondsLeft,
    };
  }

  if (!isFailedAttempt) {
    ipLoginState.set(ip, state);
    return { limited: false };
  }

  // Inisialisasi/refresh window 5 menit
  if (!state.firstFailedAt || now - state.firstFailedAt > FIVE_MINUTES_MS) {
    state.firstFailedAt = now;
    state.failedAttempts = 0;
  }

  state.failedAttempts = (state.failedAttempts || 0) + 1;
  state.dailyFailed = (state.dailyFailed || 0) + 1;

  if (state.failedAttempts >= MAX_ATTEMPTS_5_MIN && now - state.firstFailedAt <= FIVE_MINUTES_MS) {
    state.lockedUntil = new Date(now.getTime() + FIVE_MINUTES_MS);
    const msLeft = state.lockedUntil.getTime() - now.getTime();
    const secondsLeft = Math.ceil(msLeft / 1000);
    ipLoginState.set(ip, state);
    return {
      limited: true,
      reason: "5min_limit",
      secondsLeft,
    };
  }

  if (state.dailyFailed >= MAX_ATTEMPTS_DAILY) {
    ipLoginState.set(ip, state);
    return {
      limited: true,
      reason: "daily_limit",
    };
  }

  ipLoginState.set(ip, state);
  return { limited: false };
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
    const ip = req.headers["x-forwarded-for"] || req.ip;
    const userAgent = req.headers["user-agent"] || "";
    const ctx = {
      ip,
      userAgent,
      email: email ? email.toLowerCase() : undefined,
      provider: "email",
    };

    if (!email || !password) {
      logEvent("login_attempt", {
        ...ctx,
        success: false,
        reason: "missing_credentials",
        statusCode: 400,
      });
      return res
        .status(400)
        .json({
          success: false,
          code: "MISSING_CREDENTIALS",
          message: "Email dan password wajib diisi.",
        });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) {
      // Untuk email yang tidak ditemukan, tetap terapkan rate limit 5x/5 menit dan 10x/hari berbasis IP
      const limitInfo = checkAndUpdateIpRateLimitForUnknownEmail(ip, { isFailedAttempt: true });

      if (limitInfo.limited) {
        if (limitInfo.reason === "5min_limit" || limitInfo.reason === "window_lock") {
          const secondsLeft = limitInfo.secondsLeft || 300;
          logEvent("login_attempt", {
            ...ctx,
            success: false,
            reason: "user_not_found_rate_limited",
            statusCode: 429,
          });
          return buildLoginLimitResponse(res, {
            status: 429,
            code: "LOGIN_RATE_LIMIT",
            message: `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(
              secondsLeft / 60,
            )} menit.`,
            extra: { retry_after_seconds: secondsLeft },
          });
        }

        if (limitInfo.reason === "daily_limit") {
          logEvent("login_attempt", {
            ...ctx,
            success: false,
            reason: "user_not_found_daily_limit",
            statusCode: 429,
          });
          return buildLoginLimitResponse(res, {
            status: 429,
            code: "LOGIN_DAILY_LIMIT",
            message:
              "Terlalu banyak percobaan login gagal hari ini dari perangkat ini. Coba lagi besok atau periksa kembali email dan password kamu.",
          });
        }
      }

      logEvent("login_attempt", {
        ...ctx,
        success: false,
        reason: "user_not_found",
        statusCode: 400,
      });
      return res.status(400).json({
        success: false,
        code: "INVALID_CREDENTIALS",
        message: "Email atau password salah.",
      });
    }

    // Cek OTP required karena limit harian
    const now = new Date();
    const today = getTodayDateOnly();
    if (
      user.login_daily_date &&
      user.login_daily_date.toDateString() === today.toDateString() &&
      (user.login_daily_failed || 0) >= MAX_ATTEMPTS_DAILY
    ) {
      // Jika belum ada OTP aktif atau sudah expired, generate baru
      const rate = checkOtpSendRateLimit(user);
      if (rate.limited && isOTPValid(user)) {
        const retryAfter = rate.secondsLeft || 60;
        logEvent("login_otp_send", {
          ...ctx,
          userId: user._id.toString(),
          success: false,
          reason: "otp_send_rate_limited",
          statusCode: 429,
        });
        return res.status(429).json({
          success: false,
          code: "OTP_SEND_RATE_LIMIT",
          message: `Terlalu sering meminta OTP. Coba lagi dalam ${retryAfter} detik.`,
          retry_after_seconds: retryAfter,
          expires_in_seconds: getOtpExpirySeconds(user),
        });
      }

      if (!isOTPValid(user)) {
        const otp = generateOTP();
        user.otp_code = otp;
        markOtpSent(user);
        await user.save();
        await sendOTPEmail(user.email, user.otp_code);
      }

      logEvent("login_attempt", {
        ...ctx,
        userId: user._id.toString(),
        success: false,
        reason: "daily_limit_otp_required",
        statusCode: 423,
      });

      return buildLoginLimitResponse(res, {
        status: 423,
        code: "LOGIN_OTP_REQUIRED",
        message:
          "Terlalu banyak percobaan login gagal hari ini. Kami telah mengirimkan kode OTP ke email kamu.",
        extra: {
          expires_in_seconds: getOtpExpirySeconds(user),
        },
      });
    }

    if (!user.password) {
      logEvent("login_attempt", {
        ...ctx,
        userId: user._id.toString(),
        success: false,
        reason: "password_not_set_email_login",
        statusCode: 400,
      });
      return res.status(400).json({
        success: false,
        code: "PASSWORD_NOT_SET",
        message: "Akun ini terdaftar melalui Google. Silakan login dengan metode tersebut.",
      });
    }

    // Cek lock window 5 menit sebelum verifikasi password
    const windowCheck = checkAndUpdateLoginRateLimit(user, { isFailedAttempt: false });
    if (windowCheck.limited && (windowCheck.reason === "window_lock" || windowCheck.reason === "5min_limit")) {
      const secondsLeft = windowCheck.secondsLeft || 300;
      logEvent("login_attempt", {
        ...ctx,
        userId: user._id.toString(),
        success: false,
        reason: "5min_window_locked",
        statusCode: 429,
      });
      return buildLoginLimitResponse(res, {
        status: 429,
        code: "LOGIN_RATE_LIMIT",
        message: `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(
          secondsLeft / 60,
        )} menit.`,
        extra: { retry_after_seconds: secondsLeft },
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      const limitInfo = checkAndUpdateLoginRateLimit(user, { isFailedAttempt: true });
      await user.save({ validateBeforeSave: false });

      if (limitInfo.limited) {
        if (limitInfo.reason === "5min_limit" || limitInfo.reason === "window_lock") {
          const secondsLeft = limitInfo.secondsLeft || 300;
          logEvent("login_attempt", {
            ...ctx,
            userId: user._id.toString(),
            success: false,
            reason: "password_mismatch_rate_limited",
            statusCode: 429,
          });
          return buildLoginLimitResponse(res, {
            status: 429,
            code: "LOGIN_RATE_LIMIT",
            message: `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(
              secondsLeft / 60,
            )} menit.`,
            extra: { retry_after_seconds: secondsLeft },
          });
        }

        if (limitInfo.reason === "daily_limit") {
          const rate = checkOtpSendRateLimit(user);
          if (rate.limited && isOTPValid(user)) {
            const retryAfter = rate.secondsLeft || 60;
            logEvent("login_otp_send", {
              ...ctx,
              userId: user._id.toString(),
              success: false,
              reason: "otp_send_rate_limited",
              statusCode: 429,
            });
            return res.status(429).json({
              success: false,
              code: "OTP_SEND_RATE_LIMIT",
              message: `Terlalu sering meminta OTP. Coba lagi dalam ${retryAfter} detik.`,
              retry_after_seconds: retryAfter,
              expires_in_seconds: getOtpExpirySeconds(user),
            });
          }

          // Pastikan ada OTP yang masih valid, jika tidak buat baru
          if (!isOTPValid(user)) {
            const otp = generateOTP();
            user.otp_code = otp;
            markOtpSent(user);
            await user.save();
            await sendOTPEmail(user.email, user.otp_code);
          }

          logEvent("login_attempt", {
            ...ctx,
            userId: user._id.toString(),
            success: false,
            reason: "password_mismatch_daily_limit_otp_required",
            statusCode: 423,
          });

          return buildLoginLimitResponse(res, {
            status: 423,
            code: "LOGIN_OTP_REQUIRED",
            message:
              "Terlalu banyak percobaan login gagal hari ini. Kami telah mengirimkan kode OTP ke email kamu.",
            extra: {
              expires_in_seconds: getOtpExpirySeconds(user),
            },
          });
        }
      }

      logEvent("login_attempt", {
        ...ctx,
        userId: user._id.toString(),
        success: false,
        reason: "password_mismatch",
        statusCode: 400,
      });
      return res.status(400).json({
        success: false,
        code: "INVALID_CREDENTIALS",
        message: "Email atau password salah.",
      });
    }

    resetLoginRateLimitCounters(user);
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);

    logEvent("login_attempt", {
      ...ctx,
      userId: user._id.toString(),
      success: true,
      reason: "ok",
      statusCode: 200,
    });

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
    const { email, name, uid, photo_url } = req.body;
    const ip = req.headers["x-forwarded-for"] || req.ip;
    const userAgent = req.headers["user-agent"] || "";
    const base = {
      ip,
      userAgent,
      provider: "google",
      email: email ? email.toLowerCase() : undefined,
      uid,
    };

    if (!uid || !email) {
      logEvent("google_login", {
        ...base,
        success: false,
        reason: "missing_google_fields",
        statusCode: 400,
      });
      return res.status(400).json({
        success: false,
        message: "UID dan email dari akun Google wajib dikirim.",
      });
    }

    let user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password",
    );

    if (!user) {
      user = await User.create({
        email: email.toLowerCase(),
        name: name || "",
        auth_provider: "google",
        firebase_uid: uid,
      });
    } else {
      let changed = false;
      if (!user.firebase_uid) {
        user.firebase_uid = uid;
        changed = true;
      }
      if (name && !user.name) {
        user.name = name;
        changed = true;
      }
      if (changed) {
        await user.save();
      }
    }

    const needsPassword = !user.password;
    const token = generateToken(user._id);

    const safeUser = user.toJSON();

    logEvent("google_login", {
      ...base,
      userId: user._id.toString(),
      success: true,
      reason: "ok",
      statusCode: 200,
    });

    res.json({
      success: true,
      message: "Login Google berhasil.",
      data: { user: safeUser, token, needs_password: needsPassword },
    });
  } catch (error) {
    next(error);
  }
};

const setGooglePassword = async (req, res, next) => {
  try {
    const { new_password, confirm_password } = req.body;

    if (!new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Password baru dan konfirmasi wajib diisi.",
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password minimal 6 karakter.",
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Konfirmasi password tidak sama.",
      });
    }

    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User tidak ditemukan.",
      });
    }

    if (user.auth_provider !== "google") {
      return res.status(400).json({
        success: false,
        message: "Set password hanya tersedia untuk akun Google.",
      });
    }

    if (user.password) {
      return res.status(400).json({
        success: false,
        message: "Password sudah pernah diset untuk akun ini.",
      });
    }

    user.password = new_password;
    await user.save();

    const token = generateToken(user._id);
    const safeUser = user.toJSON();

    res.json({
      success: true,
      message: "Password berhasil diset.",
      data: { user: safeUser, token },
    });
  } catch (error) {
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

    const rate = checkOtpSendRateLimit(user);
    if (rate.limited) {
      const retryAfter = rate.secondsLeft || 60;
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

    await sendOTPEmail(email, otp);

    const expiresIn = getOtpExpirySeconds(user);

    res.json({
      success: true,
      message: "Kode OTP telah dikirim ke email kamu.",
      data: {
        expires_in_seconds: expiresIn,
      },
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

    const ctx = buildRequestContext(req);

    if (!isOTPValid(user)) {
      logEvent("otp_verify", {
        ...ctx,
        email: user.email,
        success: false,
        statusCode: 400,
        reason: "expired",
      });
      return res.status(400).json({ success: false, message: "Kode OTP sudah expired. Silakan minta ulang." });
    }

    if (user.otp_code !== otp) {
      logEvent("otp_verify", {
        ...ctx,
        email: user.email,
        success: false,
        statusCode: 400,
        reason: "mismatch",
      });
      return res.status(400).json({ success: false, message: "Kode OTP salah." });
    }

    logEvent("otp_verify", {
      ...ctx,
      email: user.email,
      success: true,
      statusCode: 200,
    });

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

    const ctx = buildRequestContext(req);

    if (!isOTPValid(user) || user.otp_code !== otp) {
      logEvent("password_reset", {
        ...ctx,
        email: user.email,
        success: false,
        statusCode: 400,
        reason: "otp_invalid",
      });
      return res.status(400).json({ success: false, message: "Kode OTP tidak valid atau sudah expired." });
    }

    user.password = new_password;
    user.otp_code = null;
    user.otp_expires = null;
    await user.save();

    logEvent("password_reset", {
      ...ctx,
      email: user.email,
      success: true,
      statusCode: 200,
    });

    res.json({
      success: true,
      message: "Password berhasil direset.",
    });
  } catch (error) {
    next(error);
  }
};

const loginOTPVerify = async (req, res, next) => {
  try {
    const { email, otp, new_password } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message: "Email dan OTP wajib diisi.",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "Email tidak ditemukan.",
      });
    }

    const ctx = buildRequestContext(req);

    if (!isOTPValid(user) || user.otp_code !== otp) {
      logEvent("login_otp_verify", {
        ...ctx,
        email: user.email,
        userId: user._id.toString(),
        success: false,
        statusCode: 400,
        reason: "otp_invalid",
      });
      return res.status(400).json({
        success: false,
        code: "INVALID_OTP",
        message: "Kode OTP tidak valid atau sudah expired.",
      });
    }

    // Jika user mengirim password baru, langsung ganti password
    if (new_password) {
      if (typeof new_password !== "string" || new_password.length < 6) {
        return res.status(400).json({
          success: false,
          code: "INVALID_NEW_PASSWORD",
          message: "Password baru minimal 6 karakter.",
        });
      }
      user.password = new_password;
    }

    // Bersihkan OTP dan reset counter login gagal
    user.otp_code = null;
    user.otp_expires = null;
    resetLoginRateLimitCounters(user);

    await user.save();

    const token = generateToken(user._id);
    const safeUser = user.toJSON();

    logEvent("login_otp_verify", {
      ...ctx,
      email: user.email,
      userId: user._id.toString(),
      success: true,
      statusCode: 200,
      withPasswordChange: Boolean(new_password),
    });

    res.json({
      success: true,
      message: new_password
        ? "OTP terverifikasi dan password berhasil diganti."
        : "OTP terverifikasi. Silakan ganti password sekarang.",
      data: {
        user: safeUser,
        token,
        must_change_password: !new_password,
      },
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
  setGooglePassword,
  loginOTPVerify,
};
