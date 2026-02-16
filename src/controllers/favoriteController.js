const Favorite = require("../models/Favorite");
const Recipe = require("../models/Recipe");
const { isMongoConnected } = require("../config/db");
const sqlite = require("../sqlite/offline");

const getFavorites = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let favorites = sqlite.getFavorites(userId, parseInt(limit), offset);
    let total = sqlite.countFavorites(userId);

    if (favorites.length === 0 && isMongoConnected()) {
      const mongoFavorites = await Favorite.find({ user_id: req.user._id })
        .populate("recipe_id")
        .sort({ created_at: -1 });

      if (mongoFavorites.length > 0) {
        sqlite.bulkLoadFavoritesFromMongo(mongoFavorites);
        favorites = sqlite.getFavorites(userId, parseInt(limit), offset);
        total = sqlite.countFavorites(userId);
      }
    }

    res.json({
      success: true,
      data: favorites.map((fav) => ({
        _id: fav.id || fav._id,
        recipe_mongo_id: fav.recipe_mongo_id,
        recipe: fav.recipe,
        created_at: fav.created_at,
      })),
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

const addFavorite = async (req, res, next) => {
  try {
    const { recipeId } = req.params;
    const userId = req.user._id.toString();

    let recipeData = sqlite.getCachedRecipeById(recipeId);

    if (!recipeData && isMongoConnected()) {
      const recipe = await Recipe.findById(recipeId);
      if (!recipe) {
        return res.status(404).json({ success: false, message: "Resep tidak ditemukan." });
      }
      sqlite.cacheRecipe(recipe);
      recipeData = recipe;
    }

    if (!recipeData) {
      return res.status(404).json({ success: false, message: "Resep tidak ditemukan." });
    }

    const result = sqlite.saveFavorite(userId, recipeId, recipeData);

    if (result.existed) {
      return res.status(400).json({ success: false, message: "Resep sudah ada di favorit." });
    }

    sqlite.addToSyncQueue("create", "favorites", null, userId, { recipe_id: recipeId });

    res.status(201).json({
      success: true,
      message: "Resep ditambahkan ke favorit.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const removeFavorite = async (req, res, next) => {
  try {
    const { recipeId } = req.params;
    const userId = req.user._id.toString();

    const deleted = sqlite.deleteFavorite(userId, recipeId);

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Resep tidak ada di favorit." });
    }

    sqlite.addToSyncQueue("delete", "favorites", null, userId, { recipe_id: recipeId });

    res.json({
      success: true,
      message: "Resep dihapus dari favorit.",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getFavorites, addFavorite, removeFavorite };
