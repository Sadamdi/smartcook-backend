const mongoose = require("mongoose");

const favoriteSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  recipe_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Recipe",
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

favoriteSchema.index({ user_id: 1, recipe_id: 1 }, { unique: true });
favoriteSchema.index({ user_id: 1 });

module.exports = mongoose.model("Favorite", favoriteSchema);
