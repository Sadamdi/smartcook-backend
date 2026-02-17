const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  createIngredientGlobal,
  listIngredientsGlobal,
} = require("../controllers/ingredientController");

router.get("/", listIngredientsGlobal);
router.post("/", protect, createIngredientGlobal);

module.exports = router;

