const FridgeItem = require("../models/FridgeItem");

const getFridgeItems = async (req, res, next) => {
  try {
    const items = await FridgeItem.find({ user_id: req.user._id }).sort({ category: 1, ingredient_name: 1 });
    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};

const addFridgeItem = async (req, res, next) => {
  try {
    const { ingredient_name, category, quantity, unit, expired_date } = req.body;

    if (!ingredient_name || !category) {
      return res.status(400).json({ success: false, message: "Nama bahan dan kategori wajib diisi." });
    }
    const validCategories = ["protein", "karbo", "sayur", "bumbu"];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ success: false, message: "Kategori harus protein, karbo, sayur, atau bumbu." });
    }

    const existing = await FridgeItem.findOne({
      user_id: req.user._id,
      ingredient_name,
      category,
    });
    if (existing) {
      existing.quantity += quantity || 0;
      await existing.save();
      return res.status(200).json({
        success: true,
        message: "Jumlah bahan diupdate.",
        data: existing,
      });
    }

    const item = await FridgeItem.create({
      user_id: req.user._id,
      ingredient_name,
      category,
      quantity: quantity || 0,
      unit: unit || "gram",
      expired_date: expired_date || null,
    });
    res.status(201).json({
      success: true,
      message: "Bahan berhasil ditambahkan ke kulkas.",
      data: item,
    });
  } catch (error) {
    next(error);
  }
};

const updateFridgeItem = async (req, res, next) => {
  try {
    const { quantity, unit, expired_date } = req.body;
    const item = await FridgeItem.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!item) {
      return res.status(404).json({ success: false, message: "Bahan tidak ditemukan." });
    }
    if (quantity !== undefined) item.quantity = quantity;
    if (unit !== undefined) item.unit = unit;
    if (expired_date !== undefined) item.expired_date = expired_date;
    await item.save();
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
    const item = await FridgeItem.findOneAndDelete({ _id: req.params.id, user_id: req.user._id });
    if (!item) {
      return res.status(404).json({ success: false, message: "Bahan tidak ditemukan." });
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
    const validCategories = ["protein", "karbo", "sayur", "bumbu"];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ success: false, message: "Kategori harus protein, karbo, sayur, atau bumbu." });
    }
    const items = await FridgeItem.find({ user_id: req.user._id, category }).sort({ ingredient_name: 1 });
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
