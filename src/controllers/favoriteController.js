const Favorite = require("../models/Favorite");
const Recipe = require("../models/Recipe");
const { isMongoConnected } = require("../config/db");
const mysql = require("../mysql/offline");

const getFavorites = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let favorites = await mysql.getFavorites(userId, parseInt(limit), offset);
    let total = await mysql.countFavorites(userId);

    if (favorites.length === 0 && isMongoConnected()) {
      const mongoFavorites = await Favorite.find({ user_id: req.user._id })
        .populate("recipe_id")
        .sort({ created_at: -1 });

      if (mongoFavorites.length > 0) {
        await mysql.bulkLoadFavoritesFromMongo(mongoFavorites);
        favorites = await mysql.getFavorites(userId, parseInt(limit), offset);
        total = await mysql.countFavorites(userId);
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

    let recipeData = await mysql.getCachedRecipeById(recipeId);

    if (!recipeData && isMongoConnected()) {
      const recipe = await Recipe.findById(recipeId);
      if (!recipe) {
        return res.status(404).json({ success: false, message: "Resep tidak ditemukan." });
      }
      await mysql.cacheRecipe(recipe);
      recipeData = recipe;
    }

    if (!recipeData) {
      return res.status(404).json({ success: false, message: "Resep tidak ditemukan." });
    }

    const result = await mysql.saveFavorite(userId, recipeId, recipeData);

    if (result.existed) {
      return res.status(400).json({ success: false, message: "Resep sudah ada di favorit." });
    }

    await mysql.addToSyncQueue("create", "favorites", null, userId, { recipe_id: recipeId });

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

    const deleted = await mysql.deleteFavorite(userId, recipeId);

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Resep tidak ada di favorit." });
    }

    await mysql.addToSyncQueue("delete", "favorites", null, userId, { recipe_id: recipeId });

    res.json({
      success: true,
      message: "Resep dihapus dari favorit.",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getFavorites, addFavorite, removeFavorite };
