const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  getRecipes,
  getRecipeById,
  searchRecipes,
  aiSearchRecipes,
  getRecommendations,
  getByMealType,
} = require("../controllers/recipeController");

router.get("/", getRecipes);
router.get("/search", searchRecipes);
router.get("/ai-search", protect, aiSearchRecipes);
router.get("/recommendations", protect, getRecommendations);
router.get("/by-meal/:type", getByMealType);
router.get("/:id", getRecipeById);

module.exports = router;
