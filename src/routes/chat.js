const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  sendMessage,
  sendMessageStream,
  getHistory,
  deleteHistory,
} = require("../controllers/chatController");

router.post("/message", protect, sendMessage);
router.post("/message-stream", protect, sendMessageStream);
router.get("/history", protect, getHistory);
router.delete("/history", protect, deleteHistory);

module.exports = router;
