const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  getRecipes,
  getRecipeById,
  getRecipeWithFridge,
  searchRecipes,
  queryRecipes,
  aiSearchRecipes,
  getRecommendations,
  getByMealType,
  getPopularRecipes,
  globalSearchRecipes,
} = require("../controllers/recipeController");

router.get("/", getRecipes);
router.get("/search", searchRecipes);
router.get("/global-search", protect, globalSearchRecipes);
router.get("/query", protect, queryRecipes);
router.get("/ai-search", protect, aiSearchRecipes);
router.get("/recommendations", protect, getRecommendations);
router.get("/by-meal/:type", getByMealType);
router.get("/popular", getPopularRecipes);
router.get("/with-fridge/:id", protect, getRecipeWithFridge);
router.get("/:id", getRecipeById);

module.exports = router;
