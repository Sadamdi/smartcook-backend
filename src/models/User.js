const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    minlength: 6,
    select: false,
  },
  name: {
    type: String,
    trim: true,
    default: "",
  },
  auth_provider: {
    type: String,
    enum: ["email", "google"],
    default: "email",
  },
  firebase_uid: {
    type: String,
    default: null,
  },
  age_range: {
    type: String,
    enum: ["< 12 thn", "12 - 17 thn", "> 17 thn", ""],
    default: "",
  },
  gender: {
    type: String,
    enum: ["Laki-laki", "Perempuan", ""],
    default: "",
  },
  allergies: {
    type: [String],
    default: [],
  },
  medical_history: {
    type: [String],
    default: [],
  },
  cooking_styles: {
    type: [String],
    default: [],
  },
  equipment: {
    type: [String],
    default: [],
  },
  onboarding_completed: {
    type: Boolean,
    default: false,
  },
  pending_email: {
    type: String,
    default: null,
  },
  // Counter untuk percobaan login gagal & rate limiting
  login_failed_attempts: {
    type: Number,
    default: 0,
  },
  login_first_failed_at: {
    type: Date,
    default: null,
  },
  login_daily_failed: {
    type: Number,
    default: 0,
  },
  login_daily_date: {
    type: Date,
    default: null,
  },
  login_locked_until: {
    type: Date,
    default: null,
  },
  otp_code: {
    type: String,
    default: null,
  },
  otp_expires: {
    type: Date,
    default: null,
  },
  otp_last_sent_at: {
    type: Date,
    default: null,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

userSchema.pre("save", async function () {
  this.updated_at = new Date();
  if (!this.isModified("password") || !this.password) {
    return;
  }
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.otp_code;
  delete obj.otp_expires;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
