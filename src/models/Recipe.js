const mongoose = require("mongoose");

const recipeSchema = new mongoose.Schema({
  // seed: dari data awal/curated, ai: hasil generate AI dari user search
  source: {
    type: String,
    enum: ["seed", "ai"],
    default: "seed",
    index: true,
  },
  // nullable untuk resep seed
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
    index: true,
  },
  // query asli yang memicu pembuatan resep AI
  origin_query: {
    type: String,
    default: "",
  },
  // query yang dinormalisasi untuk pooling hasil pencarian (global)
  origin_query_norm: {
    type: String,
    default: "",
    index: true,
  },
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
recipeSchema.index({ origin_query_norm: 1, source: 1 });

module.exports = mongoose.model("Recipe", recipeSchema);
