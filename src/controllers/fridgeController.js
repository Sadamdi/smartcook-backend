const FridgeItem = require("../models/FridgeItem");
const { isMongoConnected } = require("../config/db");
const sqlite = require("../sqlite/offline");

const getFridgeItems = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();

    let items = sqlite.getFridgeItems(userId);

    if (items.length === 0 && isMongoConnected()) {
      const mongoItems = await FridgeItem.find({ user_id: req.user._id }).sort({ category: 1, ingredient_name: 1 });
      if (mongoItems.length > 0) {
        sqlite.bulkLoadFridgeFromMongo(mongoItems);
        items = sqlite.getFridgeItems(userId);
      }
    }

    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};

const addFridgeItem = async (req, res, next) => {
  try {
    const { ingredient_name, category, quantity, unit } = req.body;
    const userId = req.user._id.toString();

    if (!ingredient_name || !category) {
      return res.status(400).json({ success: false, message: "Nama bahan dan kategori wajib diisi." });
    }

    const validCategories = ["protein", "karbo", "sayur", "bumbu"];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ success: false, message: "Kategori harus protein, karbo, sayur, atau bumbu." });
    }

    const result = sqlite.saveFridgeItem({
      user_id: userId,
      ingredient_name,
      category,
      quantity: quantity || 0,
      unit: unit || "gram",
    });

    sqlite.addToSyncQueue("create", "fridge", null, userId, {
      ingredient_name,
      category,
      quantity: result.data.quantity,
      unit: result.data.unit,
    });

    const statusCode = result.merged ? 200 : 201;
    const message = result.merged ? "Jumlah bahan diupdate." : "Bahan berhasil ditambahkan ke kulkas.";

    res.status(statusCode).json({
      success: true,
      message,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const updateFridgeItem = async (req, res, next) => {
  try {
    const { quantity, unit } = req.body;
    const userId = req.user._id.toString();

    const item = sqlite.updateFridgeItem(req.params.id, userId, { quantity, unit });

    if (!item) {
      return res.status(404).json({ success: false, message: "Bahan tidak ditemukan." });
    }

    sqlite.addToSyncQueue("update", "fridge", item.mongo_id, userId, { quantity, unit });

    res.json({
      success: true,
      message: "Bahan berhasil diupdate.",
      data: item,
    });
  } catch (error) {
    next(error);
  }
};

const deleteFridgeItem = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();

    const item = sqlite.deleteFridgeItem(req.params.id, userId);

    if (!item) {
      return res.status(404).json({ success: false, message: "Bahan tidak ditemukan." });
    }

    if (item.mongo_id) {
      sqlite.addToSyncQueue("delete", "fridge", item.mongo_id, userId, null);
    }

    res.json({
      success: true,
      message: "Bahan berhasil dihapus dari kulkas.",
    });
  } catch (error) {
    next(error);
  }
};

const getByCategory = async (req, res, next) => {
  try {
    const { category } = req.params;
    const userId = req.user._id.toString();

    const validCategories = ["protein", "karbo", "sayur", "bumbu"];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ success: false, message: "Kategori harus protein, karbo, sayur, atau bumbu." });
    }

    let items = sqlite.getFridgeItems(userId, category);

    if (items.length === 0 && isMongoConnected()) {
      const mongoItems = await FridgeItem.find({ user_id: req.user._id, category }).sort({ ingredient_name: 1 });
      if (mongoItems.length > 0) {
        sqlite.bulkLoadFridgeFromMongo(mongoItems);
        items = sqlite.getFridgeItems(userId, category);
      }
    }

    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getFridgeItems,
  addFridgeItem,
  updateFridgeItem,
  deleteFridgeItem,
  getByCategory,
};
