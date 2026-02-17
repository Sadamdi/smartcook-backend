const FridgeItem = require("../models/FridgeItem");
const { logEvent, buildRequestContext } = require("../utils/logger");

const getFridgeItems = async (req, res, next) => {
  try {
    const items = await FridgeItem.find({ user_id: req.user._id }).sort({ category: 1, ingredient_name: 1 });
    const ctx = buildRequestContext(req);
    logEvent("fridge_list", {
      ...ctx,
      success: true,
      statusCode: 200,
      count: items.length,
    });
    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};

const addFridgeItem = async (req, res, next) => {
  try {
    const { ingredient_name, category, quantity, unit, expired_date } = req.body;
    const ctx = buildRequestContext(req);

    if (!ingredient_name || !category) {
      logEvent("fridge_add", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "missing_name_or_category",
      });
      return res.status(400).json({ success: false, message: "Nama bahan dan kategori wajib diisi." });
    }
    const validCategories = ["protein", "karbo", "sayur", "bumbu"];
    if (!validCategories.includes(category)) {
      logEvent("fridge_add", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "invalid_category",
        category,
      });
      return res.status(400).json({ success: false, message: "Kategori harus protein, karbo, sayur, atau bumbu." });
    }

    const existing = await FridgeItem.findOne({
      user_id: req.user._id,
      ingredient_name,
      category,
    });
    if (existing) {
      const before = existing.quantity;
      existing.quantity += quantity || 0;
      await existing.save();
      logEvent("fridge_add", {
        ...ctx,
        success: true,
        statusCode: 200,
        action: "increment",
        ingredient_name,
        category,
        quantityBefore: before,
        quantityAfter: existing.quantity,
      });
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
    logEvent("fridge_add", {
      ...ctx,
      success: true,
      statusCode: 201,
      action: "create",
      ingredient_name,
      category,
      quantity: item.quantity,
      unit: item.unit,
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
    const ctx = buildRequestContext(req);
    if (!item) {
      logEvent("fridge_update", {
        ...ctx,
        success: false,
        statusCode: 404,
        reason: "not_found",
        itemId: req.params.id,
      });
      return res.status(404).json({ success: false, message: "Bahan tidak ditemukan." });
    }
    const before = {
      quantity: item.quantity,
      unit: item.unit,
      expired_date: item.expired_date,
    };
    if (quantity !== undefined) item.quantity = quantity;
    if (unit !== undefined) item.unit = unit;
    if (expired_date !== undefined) item.expired_date = expired_date;
    await item.save();
    logEvent("fridge_update", {
      ...ctx,
      success: true,
      statusCode: 200,
      itemId: req.params.id,
      quantityBefore: before.quantity,
      quantityAfter: item.quantity,
      unitBefore: before.unit,
      unitAfter: item.unit,
    });
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
    const ctx = buildRequestContext(req);
    if (!item) {
      logEvent("fridge_delete", {
        ...ctx,
        success: false,
        statusCode: 404,
        reason: "not_found",
        itemId: req.params.id,
      });
      return res.status(404).json({ success: false, message: "Bahan tidak ditemukan." });
    }
    logEvent("fridge_delete", {
      ...ctx,
      success: true,
      statusCode: 200,
      itemId: req.params.id,
    });
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
      const ctx = buildRequestContext(req);
      logEvent("fridge_list_by_category", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "invalid_category",
        category,
      });
      return res.status(400).json({ success: false, message: "Kategori harus protein, karbo, sayur, atau bumbu." });
    }
    const items = await FridgeItem.find({ user_id: req.user._id, category }).sort({ ingredient_name: 1 });
    const ctx = buildRequestContext(req);
    logEvent("fridge_list_by_category", {
      ...ctx,
      success: true,
      statusCode: 200,
      category,
      count: items.length,
    });
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
