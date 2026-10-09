const nodemailer = require("nodemailer");

let transporter;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

// Inline styles only: Gmail strips <style> blocks and classes from most
// clients, so anything not declared per-element disappears in the inbox.
const BRAND = "#4CAF50";

const shell = ({ heading, intro, otp, action, footnote, danger, lang }) => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8eaed;">
    <div style="background:${BRAND};padding:22px 28px;">
      <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">SmartCook</span>
      <span style="color:#ffffff;font-size:13px;opacity:0.9;margin-left:8px;">${heading}</span>
    </div>
    <div style="padding:28px;">
      ${intro}

      <div style="background:#f6f8f7;border:1px solid #e2e8e4;border-radius:12px;padding:22px 20px;text-align:center;margin:24px 0;">
        <div style="font-size:38px;font-weight:700;letter-spacing:12px;color:#1f2933;text-indent:12px;">${otp}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:10px;">${T[lang].valid}</div>
      </div>

      ${action}

      <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px;">
        ${footnote}
      </p>

      ${
        danger
          ? `<div style="background:#b91c1c;border-radius:10px;padding:14px 16px;margin:0 0 20px;">
               <div style="font-size:13px;line-height:1.55;color:#ffffff;font-weight:600;">${danger.text}</div>
             </div>`
          : ""
      }

      <p style="font-size:12px;line-height:1.6;color:#9ca3af;margin:0;">
        ${T[lang].auto}<br>
        SmartCook
      </p>
    </div>
  </div>
`;

const T = {
  id: { valid: "Berlaku 10 menit", auto: "Email ini dikirim otomatis. Jangan membalas email ini.", hi: "Halo" },
  en: { valid: "Valid for 10 minutes", auto: "This email was sent automatically. Please do not reply.", hi: "Hello" },
};

const greeting = (name, lang = "id") =>
  name
    ? `<p style="font-size:15px;line-height:1.6;color:#1f2933;margin:0 0 14px;">${T[lang].hi} <strong>${escapeHtml(
        name
      )}</strong>,</p>`
    : `<p style="font-size:15px;line-height:1.6;color:#1f2933;margin:0 0 14px;">${T[lang].hi},</p>`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const send = async ({ to, subject, html }) =>
  getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    html,
  });

/**
 * Every OTP email goes through here, with a purpose-specific template so the
 * recipient always knows which action the code authorises. A generic
 * "your OTP is" message is indistinguishable from a phishing attempt.
 */
const sendOTPEmail = async (email, otp, options = {}) => {
  const { purpose = "verify", name = null } = options;
  const lang = options.lang === "en" ? "en" : "id";

  const templatesId = {
    verify: {
      subject: "Kode verifikasi SmartCook",
      heading: "Verifikasi akun",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">Masukkan kode di bawah untuk memverifikasi alamat email kamu.</p>`,
      action: "",
      footnote:
        "Jika kamu tidak membuat atau meminta kode ini, abaikan saja email ini.",
    },

    "reset-password": {
      subject: "Kode atur ulang password SmartCook",
      heading: "Atur ulang password",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">Kami menerima permintaan untuk membuat password baru. Masukkan kode di bawah untuk melanjutkan.</p>`,
      action: "",
      footnote:
        "Kalau ini bukan kamu, abaikan email ini. Password lama kamu tetap berlaku dan tidak ada yang berubah.",
    },

    "change-password": {
      subject: "Kode ganti password SmartCook",
      heading: "Ganti password",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">Masukkan kode di bawah untuk mengonfirmasi perubahan password akun kamu.</p>`,
      action: "",
      footnote:
        "Kalau kamu tidak mengganti password, segera ganti password kamu dan hubungi kami.",
    },

    "change-email": {
      subject: "Kode ganti email SmartCook",
      heading: "Ganti email",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">Masukkan kode di bawah untuk memindahkan akun kamu ke alamat email baru.</p>`,
      action: "",
      footnote:
        "Email lama kamu tetap aktif sampai kode ini dimasukkan dengan benar.",
    },

    "login-lock": {
      subject: "Kode login SmartCook",
      heading: "Login ulang",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">Ada terlalu banyak percobaan masuk dengan password yang salah. Untuk melindungi akunmu, masukkan kode di bawah untuk melanjutkan.</p>`,
      action: "",
      footnote:
        "Kalau bukan kamu yang mencoba masuk, segera ganti password setelah masuk.",
    },

    "delete-account": {
      subject: "Kode hapus akun SmartCook",
      heading: "Hapus akun",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">Kamu meminta <strong>menghapus akun SmartCook</strong> secara permanen. Masukkan kode di bawah untuk mengonfirmasi.</p>`,
      action: `<p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 8px;">Setelah kode dimasukkan, akun dan seluruh isinya dihapus permanen.</p>`,
      footnote:
        "Kalau ini bukan kamu, abaikan email ini. Akun kamu tetap aman dan tidak ada yang berubah.",
      danger: {
        text: "Akun yang dihapus tidak dapat dipulihkan kembali.",
      },
    },
  };


  const templatesEn = {
    verify: {
      subject: "SmartCook verification code",
      heading: "Verify account",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">Enter the code below to verify your email address.</p>`,
      action: "",
      footnote: "If you did not create or request this code, you can ignore this email.",
    },
    "reset-password": {
      subject: "SmartCook password reset code",
      heading: "Reset password",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">We received a request to set a new password. Enter the code below to continue.</p>`,
      action: "",
      footnote: "If this was not you, ignore this email. Your current password stays valid and nothing changes.",
    },
    "change-password": {
      subject: "SmartCook change password code",
      heading: "Change password",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">Enter the code below to confirm the password change on your account.</p>`,
      action: "",
      footnote: "If you did not change your password, change it right away and contact us.",
    },
    "change-email": {
      subject: "SmartCook change email code",
      heading: "Change email",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">Enter the code below to move your account to the new email address.</p>`,
      action: "",
      footnote: "Your old email stays active until this code is entered correctly.",
    },
    "login-lock": {
      subject: "SmartCook sign-in code",
      heading: "Sign in again",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">There were too many sign-in attempts with a wrong password. To protect your account, enter the code below to continue.</p>`,
      action: "",
      footnote: "If it was not you trying to sign in, change your password right after signing in.",
    },
    "delete-account": {
      subject: "SmartCook delete account code",
      heading: "Delete account",
      intro: `${greeting(name, lang)}<p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0;">You asked to <strong>permanently delete your SmartCook account</strong>. Enter the code below to confirm.</p>`,
      action: `<p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 8px;">Once the code is entered, your account and everything in it is deleted permanently.</p>`,
      footnote: "If this was not you, ignore this email. Your account stays safe and nothing changes.",
      danger: {
        text: "A deleted account cannot be recovered.",
      },
    },
  };

  const templates = lang === "en" ? templatesEn : templatesId;
  const tpl = templates[purpose] || templates.verify;
  return send({
    to: email,
    subject: tpl.subject,
    html: shell({
      heading: tpl.heading,
      intro: tpl.intro,
      otp,
      action: tpl.action,
      footnote: tpl.footnote,
      danger: tpl.danger,
      lang,
    }),
  });
};

module.exports = { sendOTPEmail };
