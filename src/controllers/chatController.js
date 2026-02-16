const ChatHistory = require("../models/ChatHistory");
const FridgeItem = require("../models/FridgeItem");
const User = require("../models/User");
const { isMongoConnected } = require("../config/db");
const { getGeminiModel } = require("../config/gemini");
const mysql = require("../mysql/offline");

const buildUserContext = (user, fridgeItems) => {
  const parts = [];

  if (user.name) parts.push(`Nama pengguna: ${user.name}`);
  if (user.age_range) parts.push(`Usia: ${user.age_range}`);
  if (user.allergies && user.allergies.length > 0) {
    parts.push(`Alergi makanan: ${user.allergies.join(", ")}`);
  }
  if (user.medical_history && user.medical_history.length > 0) {
    parts.push(`Riwayat penyakit: ${user.medical_history.join(", ")}`);
  }
  if (user.cooking_styles && user.cooking_styles.length > 0) {
    parts.push(`Gaya masak favorit: ${user.cooking_styles.join(", ")}`);
  }
  if (user.equipment && user.equipment.length > 0) {
    parts.push(`Peralatan dapur: ${user.equipment.join(", ")}`);
  }

  if (fridgeItems.length > 0) {
    const ingredientList = fridgeItems.map(
      (item) => `${item.ingredient_name} (${item.quantity} ${item.unit})`
    );
    parts.push(`Bahan di kulkas: ${ingredientList.join(", ")}`);
  }

  if (parts.length === 0) return "";
  return `\n\nKonteks pengguna:\n${parts.join("\n")}`;
};

const sendMessage = async (req, res, next) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Pesan tidak boleh kosong." });
    }

    const userId = req.user._id.toString();

    const fridgeItems = await mysql.getFridgeItems(userId);
    const user = req.user;

    let mysqlChat = await mysql.getChatHistory(userId);
    let history = [];

    if (mysqlChat && mysqlChat.messages.length > 0) {
      const recentMessages = mysqlChat.messages.slice(-20);
      history = recentMessages.map((msg) => ({
        role: msg.role,
        parts: [{ text: msg.content }],
      }));
    }

    const model = getGeminiModel();
    const chat = model.startChat({ history });

    const userContext = buildUserContext(user, fridgeItems);
    const fullMessage = userContext ? `${message}\n${userContext}` : message;
    const result = await chat.sendMessage(fullMessage);
    const reply = result.response.text();

    const newUserMsg = { role: "user", content: message, timestamp: new Date().toISOString() };
    const newModelMsg = { role: "model", content: reply, timestamp: new Date().toISOString() };

    let allMessages = [];
    if (mysqlChat) {
      allMessages = [...mysqlChat.messages, newUserMsg, newModelMsg];
    } else {
      allMessages = [newUserMsg, newModelMsg];
    }

    await mysql.saveChatHistory(userId, allMessages);

    await mysql.addToSyncQueue("update", "chat", null, userId, { messages: allMessages });

    res.json({
      success: true,
      data: {
        reply,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();

    let chatData = await mysql.getChatHistory(userId);

    if (!chatData && isMongoConnected()) {
      const mongoChat = await ChatHistory.findOne({ user_id: req.user._id });
      if (mongoChat) {
        await mysql.saveChatHistory(userId, mongoChat.messages);
        chatData = { messages: mongoChat.messages, created_at: mongoChat.created_at, updated_at: mongoChat.updated_at };
      }
    }

    if (!chatData) {
      return res.json({ success: true, data: { messages: [] } });
    }

    res.json({
      success: true,
      data: {
        messages: chatData.messages,
        created_at: chatData.created_at,
        updated_at: chatData.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

const deleteHistory = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();

    await mysql.deleteChatHistory(userId);

    await mysql.addToSyncQueue("delete", "chat", null, userId, null);

    res.json({
      success: true,
      message: "Riwayat chat berhasil dihapus.",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { sendMessage, getHistory, deleteHistory };
