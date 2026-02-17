const mongoose = require("mongoose");

const fridgeItemSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  ingredient_name: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: String,
    required: true,
    enum: ["protein", "karbo", "sayur", "bumbu"],
  },
  quantity: {
    type: Number,
    default: 0,
  },
  unit: {
    type: String,
    default: "gram",
  },
  expired_date: {
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

fridgeItemSchema.index({ user_id: 1 });
fridgeItemSchema.index({ user_id: 1, category: 1 });

fridgeItemSchema.pre("save", async function () {
  this.updated_at = new Date();
});

module.exports = mongoose.model("FridgeItem", fridgeItemSchema);
