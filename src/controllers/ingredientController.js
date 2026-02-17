const Ingredient = require("../models/Ingredient");
const { logEvent, buildRequestContext } = require("../utils/logger");

const normalizeIngredientName = (name) =>
  String(name || "").toLowerCase().trim();

const createIngredientGlobal = async (req, res, next) => {
  try {
    const { name, category } = req.body;
    const ctx = buildRequestContext(req);
    const normalized = normalizeIngredientName(name);
    if (!normalized || !category) {
      logEvent("ingredient_create", {
        ...ctx,
        success: false,
        statusCode: 400,
        reason: "missing_name_or_category",
      });
      return res
        .status(400)
        .json({ success: false, message: "Nama dan kategori wajib diisi." });
    }
    const update = {
      name: name.trim(),
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
    logEvent("ingredient_create", {
      ...ctx,
      success: true,
      statusCode: 200,
      ingredientId: doc._id.toString(),
      name: doc.name,
      category: doc.category,
    });
    res.json({
      success: true,
      data: doc,
    });
  } catch (error) {
    next(error);
  }
};

const listIngredientsGlobal = async (req, res, next) => {
  try {
    const { q, category } = req.query;
    const ctx = buildRequestContext(req);
    const filter = {};
    if (category) {
      filter.category = category;
    }
    if (q) {
      const norm = normalizeIngredientName(q);
      filter.normalized_name = { $regex: norm, $options: "i" };
    }
    const items = await Ingredient.find(filter)
      .sort({ category: 1, name: 1 })
      .limit(200);
    logEvent("ingredient_list", {
      ...ctx,
      success: true,
      statusCode: 200,
      count: items.length,
      hasQuery: !!q,
    });
    res.json({
      success: true,
      data: items,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createIngredientGlobal,
  listIngredientsGlobal,
};

