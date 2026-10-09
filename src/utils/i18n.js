// Answer language for API messages and e-mails.
//
// The controllers keep writing their messages in Indonesian (the source
// language). The app sends its chosen language in `X-Smartcook-Locale` (it also
// travels inside the sealed channel); when that is English, `middleware()` swaps
// the `message` of every JSON answer for its English text right before it is
// sent. Unknown messages fall through unchanged, so a missing entry degrades to
// Indonesian instead of breaking. scripts/test-i18n.js fails if a message used
// in src/ has no English entry.

const EN = {
  "Email dan password wajib diisi.": "Email and password are required.",
  "Password minimal 6 karakter.": "Password must be at least 6 characters.",
  "Email sudah terdaftar.": "This email is already registered.",
  "Registrasi berhasil.": "Registration successful.",
  "Terlalu banyak percobaan login gagal hari ini dari perangkat ini. Coba lagi besok atau periksa kembali email dan password kamu.":
    "Too many failed sign-in attempts today from this device. Try again tomorrow or double-check your email and password.",
  "Email atau password salah.": "Wrong email or password.",
  "Terlalu banyak percobaan login gagal hari ini. Kami telah mengirimkan kode OTP ke email kamu.":
    "Too many failed sign-in attempts today. We have sent a verification code to your email.",
  "Akun ini terdaftar melalui Google. Silakan login dengan metode tersebut.":
    "This account was registered with Google. Please sign in with that method.",
  "Login berhasil.": "Signed in successfully.",
  "UID dan email wajib dikirim beserta idToken dari Google.": "UID and email are required together with the Google idToken.",
  "Google ID token tidak valid.": "The Google ID token is not valid.",
  "Google ID token tidak memiliki uid/email.": "The Google ID token has no uid/email.",
  "Email pada body tidak cocok dengan email pada Google ID token.": "The email does not match the one in the Google ID token.",
  "Login Google berhasil.": "Google sign-in successful.",
  "Password baru dan konfirmasi wajib diisi.": "New password and confirmation are required.",
  "Konfirmasi password tidak sama.": "Password confirmation does not match.",
  "User tidak ditemukan.": "User not found.",
  "Set password hanya tersedia untuk akun Google.": "Setting a password is only available for Google accounts.",
  "Password sudah pernah diset untuk akun ini.": "A password has already been set for this account.",
  "Password berhasil diset.": "Password set successfully.",
  "Email wajib diisi.": "Email is required.",
  "Email tidak ditemukan.": "Email not found.",
  "Kode OTP telah dikirim ke email kamu.": "The verification code has been sent to your email.",
  "Email dan OTP wajib diisi.": "Email and code are required.",
  "Kode OTP sudah expired. Silakan minta ulang.": "The code has expired. Please request a new one.",
  "Kode OTP salah.": "Wrong code.",
  "OTP terverifikasi.": "Code verified.",
  "Email, OTP, dan password baru wajib diisi.": "Email, code and new password are required.",
  "Kode OTP tidak valid atau sudah expired.": "The code is invalid or has expired.",
  "Password berhasil direset.": "Password reset successfully.",
  "Password baru minimal 6 karakter.": "The new password must be at least 6 characters.",
  "OTP terverifikasi dan password berhasil diganti.": "Code verified and password changed.",
  "OTP terverifikasi. Silakan ganti password sekarang.": "Code verified. Please change your password now.",
  "Kode OTP baru telah dikirim ke email kamu.": "A new code has been sent to your email.",
  "Kategori tidak valid.": "Invalid category.",
  "Pesan tidak boleh kosong.": "The message cannot be empty.",
  "Riwayat chat berhasil dihapus.": "Chat history cleared.",
  "Resep tidak ditemukan.": "Recipe not found.",
  "Resep sudah ada di favorit.": "This recipe is already in your favorites.",
  "Resep ditambahkan ke favorit.": "Recipe added to favorites.",
  "Resep tidak ada di favorit.": "This recipe is not in your favorites.",
  "Resep dihapus dari favorit.": "Recipe removed from favorites.",
  "Nama bahan dan kategori wajib diisi.": "Ingredient name and category are required.",
  "Kategori harus protein, karbo, sayur, atau bumbu.": "Category must be protein, carbs, vegetables or seasoning.",
  "Jumlah bahan diupdate.": "Ingredient quantity updated.",
  "Bahan berhasil ditambahkan ke kulkas.": "Ingredient added to your fridge.",
  "Bahan tidak ditemukan.": "Ingredient not found.",
  "Bahan berhasil diupdate.": "Ingredient updated.",
  "Bahan berhasil dihapus dari kulkas.": "Ingredient removed from your fridge.",
  "Bahan dari resep ditambahkan ke kulkas.": "Recipe ingredients added to your fridge.",
  "Nama dan kategori wajib diisi.": "Name and category are required.",
  "Query pencarian wajib diisi.": "A search query is required.",
  "Tipe meal harus breakfast, lunch, atau dinner.": "Meal type must be breakfast, lunch or dinner.",
  "Profil berhasil diupdate.": "Profile updated.",
  "Data onboarding berhasil disimpan.": "Onboarding data saved.",
  "Kode OTP untuk ganti password telah dikirim ke email kamu.": "The code to change your password has been sent to your email.",
  "Harus mengirimkan password lama atau OTP.": "Send your current password or a verification code.",
  "Password lama tidak cocok.": "The current password is wrong.",
  "Password berhasil diubah.": "Password changed.",
  "Email baru wajib diisi.": "The new email is required.",
  "Email baru tidak boleh sama dengan email lama.": "The new email cannot be the same as the current one.",
  "Email sudah digunakan oleh akun lain.": "This email is already used by another account.",
  "Kode OTP untuk ganti email telah dikirim ke email kamu. Masukkan kode tersebut untuk konfirmasi.":
    "The code to change your email has been sent to your email. Enter it to confirm.",
  "Kode OTP wajib diisi.": "The code is required.",
  "Tidak ada permintaan ganti email yang aktif.": "There is no active email change request.",
  "Email baru sudah digunakan oleh akun lain.": "The new email is already used by another account.",
  "Email berhasil diubah.": "Email changed.",
  "Akun ini belum punya email, jadi kode konfirmasi tidak bisa dikirim. Tambahkan email dulu di Profil.":
    "This account has no email yet, so the confirmation code cannot be sent. Add an email in Profile first.",
  "Kode konfirmasi telah dikirim ke email kamu.": "The confirmation code has been sent to your email.",
  "Kode salah atau sudah kedaluwarsa. Minta kode baru.": "The code is wrong or has expired. Request a new one.",
  "Akun kamu telah dihapus.": "Your account has been deleted.",
  "Akses ditolak. API key tidak ditemukan.": "Access denied. API key not found.",
  "Akses ditolak. API key tidak valid.": "Access denied. API key is not valid.",
  "Akses ditolak. Silakan masuk kembali.": "Access denied. Please sign in again.",
  "Silakan masuk kembali.": "Please sign in again.",
  "Sesi tidak valid. Silakan masuk kembali.": "Invalid session. Please sign in again.",
  "Sesi habis. Silakan masuk kembali.": "Your session has expired. Please sign in again.",
  "Access token tidak dikirim. Kirim header Authorization: Bearer <token>.":
    "Access token missing. Send the header Authorization: Bearer <token>.",
  "Access token tidak valid. Minta sesi baru melalui /api/auth/handshake.":
    "Access token is not valid. Request a new session via /api/auth/handshake.",
  "Terlalu banyak permintaan. Coba lagi nanti.": "Too many requests. Try again later.",
  "Header X-Smartcook-Cert wajib diisi.": "The X-Smartcook-Cert header is required.",
  "Field build wajib diisi (angka > 0).": "The build field is required (number > 0).",
  "Sertifikat aplikasi tidak dikenali sebagai rilis resmi.": "The app certificate is not recognised as an official release.",
  "Token dicabut.": "Token revoked.",
  "Terlalu banyak percobaan handshake. Coba lagi nanti.": "Too many handshake attempts. Try again later.",
  "Terlalu banyak permintaan refresh. Coba lagi nanti.": "Too many refresh requests. Try again later.",
  "Field refresh wajib diisi.": "The refresh field is required.",
  "Refresh token terlalu panjang.": "The refresh token is too long.",
  "Terlalu banyak percobaan sign-in Google. Coba lagi nanti.": "Too many Google sign-in attempts. Try again later.",
  "Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.": "Too many sign-in attempts. Try again in a few minutes.",
  "Endpoint tidak ditemukan.": "Endpoint not found.",
  "Nama bahan terlalu panjang.": "The ingredient name is too long.",
  "Jumlah harus berupa angka dari 0 sampai 1.000.000.": "The quantity must be a number from 0 to 1,000,000.",
  "Tanggal kadaluarsa tidak valid.": "The expiry date is not valid.",
  "Email tidak valid.": "The email is not valid.",
  "Email ini tidak bisa diubah.": "This email cannot be changed.",
  "Izin tidak boleh diberikan.": "That permission cannot be granted.",
  "Tidak bisa mengubah akun sendiri.": "You cannot change your own account.",
  "Anda telah diblokir dari layanan ini.": "You have been blocked from this service.",
  "Akun ini ditangguhkan.": "This account has been suspended.",
  "Target tidak valid.": "The target is not valid.",
  "Target ini tidak boleh dibatasi.": "This target cannot be restricted.",
  "Server error.": "Server error.",
};

const unit = (n, word) => {
  const m = { detik: ["second", "seconds"], menit: ["minute", "minutes"] }[word];
  return `${n} ${Number(n) === 1 ? m[0] : m[1]}`;
};

// Messages that carry a number or a name.
const PATTERNS = [
  [/^Terlalu banyak percobaan login\. Coba lagi dalam (\d+) menit\.$/, (m) => `Too many sign-in attempts. Try again in ${unit(m[1], "menit")}.`],
  [/^Terlalu sering meminta (?:OTP|kode)\. Coba lagi dalam (\d+) detik\.$/, (m) => `You are requesting codes too often. Try again in ${unit(m[1], "detik")}.`],
  [/^Akun ini terdaftar melalui (.+)\. Reset password tidak tersedia\.$/, (m) => `This account was registered with ${m[1]}. Password reset is not available.`],
  [
    /^Terlalu banyak (request|pesan)\. Coba lagi dalam (\d+) (detik|menit)\.$/,
    (m) => `Too many ${m[1] === "pesan" ? "messages" : "requests"}. Try again in ${unit(m[2], m[3])}.`,
  ],
];

function langOf(req) {
  const raw = String(
    (req && req.headers && (req.headers["x-smartcook-locale"] || req.headers["accept-language"])) || ""
  )
    .trim()
    .toLowerCase();
  return raw.startsWith("en") ? "en" : "id";
}

function translate(message, lang) {
  if (lang !== "en" || typeof message !== "string") return message;
  if (Object.prototype.hasOwnProperty.call(EN, message)) return EN[message];
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(message);
    if (m) return fn(m);
  }
  return message;
}

function middleware() {
  return (req, res, next) => {
    req.lang = langOf(req);
    if (req.lang === "en") {
      const json = res.json.bind(res);
      res.json = (body) => {
        if (body && typeof body === "object" && typeof body.message === "string") {
          body = { ...body, message: translate(body.message, "en") };
        }
        return json(body);
      };
    }
    next();
  };
}

module.exports = { EN, PATTERNS, langOf, translate, middleware };
