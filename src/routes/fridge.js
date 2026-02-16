const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  getFridgeItems,
  addFridgeItem,
  updateFridgeItem,
  deleteFridgeItem,
  getByCategory,
} = require("../controllers/fridgeController");

router.get("/", protect, getFridgeItems);
router.post("/", protect, addFridgeItem);
router.put("/:id", protect, updateFridgeItem);
router.delete("/:id", protect, deleteFridgeItem);
router.get("/by-category/:category", protect, getByCategory);

module.exports = router;
