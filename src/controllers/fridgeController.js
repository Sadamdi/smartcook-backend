const mongoose = require("mongoose");
const FridgeItem = require("../models/FridgeItem");
const Recipe = require("../models/Recipe");
const Ingredient = require("../models/Ingredient");
const { logEvent, buildRequestContext } = require("../utils/logger");
const {
  MAX_NAME,
  CATEGORIES,
  parseQuantity,
  parseExpiry,
  parseLooseQuantity,
  cleanName,
  exactCI,
  classifyIngredientCategory,
} = require("../utils/fridge");

const syncIngredientCatalog = async (name, category, ctx) => {
  try {
    const normalized = String(name || "").toLowerCase().trim();
    if (!normalized || !category) return;
    const update = {
      name: String(name || "").trim(),
      normalized_name: normalized,
      category,
    };
    const options = {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    };
    const doc = await Ingredient.findOneAndUpdate(
      { normalized_name: normalized },
      update,
      options,
    );
    logEvent("ingredient_sync_from_fridge", {
      ...ctx,
      success: true,
      statusCode: 200,
      ingredientId: doc._id.toString(),
      name: doc.name,
      category: doc.category,
    });
  } catch (error) {
    logEvent("ingredient_sync_from_fridge", {
      ...(ctx || {}),
      success: false,
      statusCode: 500,
      reason: "sync_failed",
    });
  }
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
    const { category, unit } = req.body;
    const ingredient_name = cleanName(req.body.ingredient_name);
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
    if (ingredient_name.length > MAX_NAME) {
      return res.status(400).json({ success: false, message: "Nama bahan terlalu panjang." });
    }
    const qty = parseQuantity(req.body.quantity);
    if (!qty.ok) {
      return res.status(400).json({ success: false, message: "Jumlah harus berupa angka dari 0 sampai 1.000.000." });
    }
    const exp = parseExpiry(req.body.expired_date);
    if (!exp.ok) {
      return res.status(400).json({ success: false, message: "Tanggal kadaluarsa tidak valid." });
    }
    const quantity = qty.value;
    const unitName = String(unit || "gram").trim().slice(0, 20) || "gram";
    if (!CATEGORIES.includes(category)) {
      logEvent("fridge_add", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "invalid_category",
        category,
      });
      return res.status(400).json({ success: false, message: "Kategori harus protein, karbo, sayur, atau bumbu." });
    }

    // Same ingredient = same name (any letter case), category AND unit: adding
    // 200 gram to "2 pcs" must not become "202 pcs".
    const existing = await FridgeItem.findOne({
      user_id: req.user._id,
      ingredient_name: exactCI(ingredient_name),
      category,
      unit: exactCI(unitName),
    });
    if (existing) {
      const before = existing.quantity;
      existing.quantity = Math.min((Number(existing.quantity) || 0) + quantity, 1000000);
      if (exp.value) existing.expired_date = exp.value;
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
      quantity,
      unit: unitName,
      expired_date: exp.value,
    });
    await syncIngredientCatalog(ingredient_name, category, ctx);
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
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Bahan tidak ditemukan." });
    }
    let nextQty;
    if (quantity !== undefined) {
      const q = parseQuantity(quantity);
      if (!q.ok) {
        return res.status(400).json({ success: false, message: "Jumlah harus berupa angka dari 0 sampai 1.000.000." });
      }
      nextQty = q.value;
    }
    const nextExp = expired_date === undefined ? undefined : parseExpiry(expired_date);
    if (nextExp && !nextExp.ok) {
      return res.status(400).json({ success: false, message: "Tanggal kadaluarsa tidak valid." });
    }
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
    if (nextQty !== undefined) item.quantity = nextQty;
    if (unit !== undefined) item.unit = String(unit).trim().slice(0, 20) || item.unit;
    if (nextExp !== undefined) item.expired_date = nextExp.value;
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
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Bahan tidak ditemukan." });
    }
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
    const recipe = mongoose.isValidObjectId(req.params.id) ? await Recipe.findById(req.params.id) : null;
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
      const quantityNumber = parseLooseQuantity(quantityRaw);
      const unitValue = String(unitRaw || "").trim() || "pcs";
      const item = await FridgeItem.create({
        user_id: req.user._id,
        ingredient_name: name,
        category: classifyIngredientCategory(name),
        quantity: quantityNumber,
        unit: unitValue,
        expired_date: null,
      });
      await syncIngredientCatalog(name, classifyIngredientCategory(name), ctx);
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
