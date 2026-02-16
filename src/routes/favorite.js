const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  getFavorites,
  addFavorite,
  removeFavorite,
} = require("../controllers/favoriteController");

router.get("/", protect, getFavorites);
router.post("/:recipeId", protect, addFavorite);
router.delete("/:recipeId", protect, removeFavorite);

module.exports = router;
