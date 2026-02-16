const Recipe = require("../models/Recipe");
const FridgeItem = require("../models/FridgeItem");
const User = require("../models/User");
const { isMongoConnected } = require("../config/db");
const {
  getCachedRecipes,
  getCachedRecipeById,
  countCachedRecipes,
  searchCachedRecipes,
  cacheMultipleRecipes,
  cacheRecipe,
  getFridgeItems: getMySQLFridge,
} = require("../mysql/offline");

const getRecipes = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, category, tags } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let recipes = await getCachedRecipes({
      category,
      tags,
      limit: parseInt(limit),
      offset,
    });
    let total = await countCachedRecipes({ category });

    if (recipes.length === 0 && isMongoConnected()) {
      const query = {};
      if (category) query.category = category;
      if (tags) query.tags = { $in: tags.split(",") };

      const mongoRecipes = await Recipe.find(query)
        .skip(offset)
        .limit(parseInt(limit))
        .sort({ created_at: -1 });

      total = await Recipe.countDocuments(query);

      if (mongoRecipes.length > 0) {
        await cacheMultipleRecipes(mongoRecipes);
        recipes = mongoRecipes;
      }
    }

    res.json({
      success: true,
      data: recipes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getRecipeById = async (req, res, next) => {
  try {
    let recipe = await getCachedRecipeById(req.params.id);

    if (!recipe && isMongoConnected()) {
      const mongoRecipe = await Recipe.findById(req.params.id);
      if (mongoRecipe) {
        await cacheRecipe(mongoRecipe);
        recipe = mongoRecipe;
      }
    }

    if (!recipe) {
      return res.status(404).json({ success: false, message: "Resep tidak ditemukan." });
    }

    res.json({ success: true, data: recipe });
  } catch (error) {
    next(error);
  }
};

const searchRecipes = async (req, res, next) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;

    if (!q) {
      return res.status(400).json({ success: false, message: "Query pencarian wajib diisi." });
    }

    let recipes = await searchCachedRecipes(q, parseInt(limit));
    let total = recipes.length;

    if (recipes.length === 0 && isMongoConnected()) {
      recipes = await Recipe.find({ $text: { $search: q } })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .sort({ score: { $meta: "textScore" } });

      total = await Recipe.countDocuments({ $text: { $search: q } });

      if (recipes.length > 0) {
        await cacheMultipleRecipes(recipes);
      }
    }

    res.json({
      success: true,
      data: recipes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getRecommendations = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();
    const { limit = 5 } = req.query;

    const mysqlFridge = await getMySQLFridge(userId);
    let ingredientNames = mysqlFridge.map((item) => item.ingredient_name.toLowerCase());

    if (ingredientNames.length === 0 && isMongoConnected()) {
      const mongoFridge = await FridgeItem.find({ user_id: req.user._id });
      ingredientNames = mongoFridge.map((item) => item.ingredient_name.toLowerCase());
    }

    let recipes = [];

    if (ingredientNames.length > 0) {
      const allRecipes = await getCachedRecipes({ limit: 200 });
      recipes = allRecipes.filter((recipe) => {
        if (!recipe.ingredients) return false;
        return recipe.ingredients.some((ing) =>
          ingredientNames.some((name) => ing.name.toLowerCase().includes(name))
        );
      }).slice(0, parseInt(limit));
    }

    if (recipes.length === 0 && isMongoConnected()) {
      const user = await User.findById(req.user._id);

      let query = {};
      if (ingredientNames.length > 0) {
        query["ingredients.name"] = {
          $in: ingredientNames.map((name) => new RegExp(name, "i")),
        };
      }
      if (user.allergies && user.allergies.length > 0) {
        query.not_suitable_for = { $nin: user.allergies };
      }
      if (user.cooking_styles && user.cooking_styles.length > 0) {
        query.tags = { $in: user.cooking_styles };
      }

      recipes = await Recipe.find(query).limit(parseInt(limit));

      if (recipes.length === 0) {
        recipes = await Recipe.aggregate([{ $sample: { size: parseInt(limit) } }]);
      }

      if (recipes.length > 0) {
        await cacheMultipleRecipes(recipes);
      }
    }

    if (recipes.length === 0) {
      recipes = await getCachedRecipes({ limit: parseInt(limit) });
    }

    res.json({ success: true, data: recipes });
  } catch (error) {
    next(error);
  }
};

const getByMealType = async (req, res, next) => {
  try {
    const { type } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const validTypes = ["breakfast", "lunch", "dinner"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Tipe meal harus breakfast, lunch, atau dinner.",
      });
    }

    let recipes = await getCachedRecipes({ meal_type: type, limit: parseInt(limit), offset });
    let total = await countCachedRecipes({ meal_type: type });

    if (recipes.length === 0 && isMongoConnected()) {
      const mongoRecipes = await Recipe.find({ meal_type: type })
        .skip(offset)
        .limit(parseInt(limit))
        .sort({ created_at: -1 });

      total = await Recipe.countDocuments({ meal_type: type });

      if (mongoRecipes.length > 0) {
        await cacheMultipleRecipes(mongoRecipes);
        recipes = mongoRecipes;
      }
    }

    res.json({
      success: true,
      data: recipes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getRecipes,
  getRecipeById,
  searchRecipes,
  getRecommendations,
  getByMealType,
};
