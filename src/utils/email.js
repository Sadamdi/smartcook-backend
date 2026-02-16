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

const sendOTPEmail = async (email, otp) => {
  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: email,
    subject: "SmartCook - Kode Verifikasi OTP",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">SmartCook</h2>
        <p>Halo,</p>
        <p>Kode verifikasi OTP kamu adalah:</p>
        <div style="background-color: #f4f4f4; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <h1 style="color: #333; letter-spacing: 8px; margin: 0;">${otp}</h1>
        </div>
        <p>Kode ini berlaku selama <strong>10 menit</strong>.</p>
        <p>Jika kamu tidak meminta kode ini, abaikan email ini.</p>
        <br>
        <p>Salam,<br>Tim SmartCook</p>
      </div>
    `,
  };

  return getTransporter().sendMail(mailOptions);
};

module.exports = { sendOTPEmail };
