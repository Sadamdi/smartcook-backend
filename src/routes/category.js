const express = require("express");
const router = express.Router();
const {
  getCookingStyles,
  getMealTypes,
  getIngredients,
} = require("../controllers/categoryController");

router.get("/cooking-styles", getCookingStyles);
router.get("/meal-types", getMealTypes);
router.get("/ingredients", getIngredients);

module.exports = router;
