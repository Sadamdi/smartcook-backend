const mongoose = require("mongoose");

const ingredientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  normalized_name: {
    type: String,
    index: true,
    unique: true,
    sparse: true,
  },
  category: {
    type: String,
    required: true,
    enum: ["protein", "karbo", "sayur", "bumbu"],
  },
  sub_category: {
    type: String,
    default: "",
  },
  unit: {
    type: String,
    default: "gram",
  },
  common_quantity: {
    type: Number,
    default: 0,
  },
  image_url: {
    type: String,
    default: "",
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

ingredientSchema.index({ category: 1 });
ingredientSchema.index({ name: "text" });

module.exports = mongoose.model("Ingredient", ingredientSchema);
