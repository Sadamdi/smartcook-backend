const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  getFridgeItems,
  addFridgeItem,
  updateFridgeItem,
  deleteFridgeItem,
  getByCategory,
  addMissingFromRecipe,
} = require("../controllers/fridgeController");

router.get("/", protect, getFridgeItems);
router.post("/", protect, addFridgeItem);
router.put("/:id", protect, updateFridgeItem);
router.delete("/:id", protect, deleteFridgeItem);
router.get("/by-category/:category", protect, getByCategory);
router.post("/bulk-from-recipe/:id", protect, addMissingFromRecipe);

module.exports = router;
