const FridgeItem = require("../models/FridgeItem");
const Recipe = require("../models/Recipe");
const { logEvent, buildRequestContext } = require("../utils/logger");

const classifyIngredientCategory = (name) => {
  const s = String(name || "").toLowerCase();
  if (!s) return "bumbu";
  if (
    s.includes("ayam") ||
    s.includes("daging") ||
    s.includes("telur") ||
    s.includes("ikan") ||
    s.includes("udang") ||
    s.includes("sapi")
  ) {
    return "protein";
  }
  if (
    s.includes("nasi") ||
    s.includes("beras") ||
    s.includes("mie") ||
    s.includes("mi") ||
    s.includes("kentang") ||
    s.includes("roti") ||
    s.includes("tepung")
  ) {
    return "karbo";
  }
  if (
    s.includes("wortel") ||
    s.includes("kol") ||
    s.includes("kubis") ||
    s.includes("selada") ||
    s.includes("tomat") ||
    s.includes("bayam") ||
    s.includes("sayur")
  ) {
    return "sayur";
  }
  return "bumbu";
};

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

const addMissingFromRecipe = async (req, res, next) => {
  try {
    const recipe = await Recipe.findById(req.params.id);
    const ctx = buildRequestContext(req);
    if (!recipe) {
      logEvent("fridge_bulk_from_recipe", {
        ...ctx,
        success: false,
        statusCode: 404,
        reason: "recipe_not_found",
        recipeId: req.params.id,
      });
      return res
        .status(404)
        .json({ success: false, message: "Resep tidak ditemukan." });
    }
    const existingItems = await FridgeItem.find({ user_id: req.user._id });
    const existingMap = new Map();
    for (const item of existingItems) {
      const key = String(item.ingredient_name || "")
        .toLowerCase()
        .trim();
      if (!key) continue;
      if (!existingMap.has(key)) existingMap.set(key, item);
    }
    const raw = recipe.toObject();
    const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients : [];
    const createdItems = [];
    for (const ing of ingredients) {
      const name = ing && typeof ing === "object" ? ing.name || "" : ing;
      const key = String(name || "")
        .toLowerCase()
        .trim();
      if (!key || existingMap.has(key)) continue;
      const quantityRaw =
        ing && typeof ing === "object" ? ing.quantity || "" : "";
      const unitRaw = ing && typeof ing === "object" ? ing.unit || "" : "";
      const quantityNumber =
        typeof quantityRaw === "number"
          ? quantityRaw
          : parseFloat(String(quantityRaw).replace(/[^0-9.]/g, "")) || 0;
      const unitValue = String(unitRaw || "").trim() || "pcs";
      const item = await FridgeItem.create({
        user_id: req.user._id,
        ingredient_name: name,
        category: classifyIngredientCategory(name),
        quantity: quantityNumber,
        unit: unitValue,
        expired_date: null,
      });
      existingMap.set(key, item);
      createdItems.push(item);
    }
    logEvent("fridge_bulk_from_recipe", {
      ...ctx,
      success: true,
      statusCode: 200,
      recipeId: req.params.id,
      createdCount: createdItems.length,
    });
    res.json({
      success: true,
      message: "Bahan dari resep ditambahkan ke kulkas.",
      data: {
        createdCount: createdItems.length,
        items: createdItems,
      },
    });
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
  addMissingFromRecipe,
};
