const mongoose = require("mongoose");

const recipeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: "",
  },
  image_url: {
    type: String,
    default: "",
  },
  ingredients: [
    {
      name: { type: String, required: true },
      quantity: { type: String, default: "" },
      unit: { type: String, default: "" },
    },
  ],
  steps: [
    {
      order: { type: Number, required: true },
      instruction: { type: String, required: true },
    },
  ],
  category: {
    type: String,
    default: "",
  },
  meal_type: {
    type: [String],
    enum: ["breakfast", "lunch", "dinner"],
    default: [],
  },
  tags: {
    type: [String],
    default: [],
  },
  prep_time: {
    type: Number,
    default: 0,
  },
  cook_time: {
    type: Number,
    default: 0,
  },
  servings: {
    type: Number,
    default: 1,
  },
  nutrition_info: {
    calories: { type: Number, default: 0 },
    protein: { type: Number, default: 0 },
    carbs: { type: Number, default: 0 },
    fat: { type: Number, default: 0 },
  },
  suitable_for: {
    type: [String],
    default: [],
  },
  not_suitable_for: {
    type: [String],
    default: [],
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

recipeSchema.index({ title: "text", description: "text", tags: "text" });
recipeSchema.index({ meal_type: 1 });
recipeSchema.index({ category: 1 });
recipeSchema.index({ tags: 1 });

module.exports = mongoose.model("Recipe", recipeSchema);
