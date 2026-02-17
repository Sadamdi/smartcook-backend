const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["user", "model"],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  recipe_embeds: {
    type: [{
      _id: String,
      title: String,
      image_url: String,
      nutrition_info: {
        calories: Number,
        protein: Number,
        carbs: Number,
        fat: Number,
      },
      prep_time: Number,
      cook_time: Number,
    }],
    default: [],
  },
});

const chatHistorySchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  messages: {
    type: [messageSchema],
    default: [],
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

chatHistorySchema.index({ user_id: 1 });

chatHistorySchema.pre("save", async function () {
  this.updated_at = new Date();
});

module.exports = mongoose.model("ChatHistory", chatHistorySchema);
