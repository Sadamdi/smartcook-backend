const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { pullData, pushData, getStatus } = require("../controllers/syncController");

router.post("/pull", protect, pullData);
router.post("/push", protect, pushData);
router.get("/status", protect, getStatus);

module.exports = router;
