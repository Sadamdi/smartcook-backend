const { isMongoConnected } = require("../config/db");
const { syncToMongo, pullFromMongo } = require("../utils/syncService");
const sqlite = require("../sqlite/offline");

const pullData = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();

    if (!isMongoConnected()) {
      const recipes = sqlite.getCachedRecipes({ limit: 100 });
      const ingredients = sqlite.getCachedIngredients();
      const fridge = sqlite.getFridgeItems(userId);
      const favorites = sqlite.getFavorites(userId, 100, 0);

      return res.json({
        success: true,
        data: { recipes, ingredients, fridge, favorites },
        source: "sqlite",
        synced_at: new Date(),
      });
    }

    const pulled = await pullFromMongo(userId);

    const recipes = sqlite.getCachedRecipes({ limit: 100 });
    const ingredients = sqlite.getCachedIngredients();
    const fridge = sqlite.getFridgeItems(userId);
    const favorites = sqlite.getFavorites(userId, 100, 0);

    res.json({
      success: true,
      data: { recipes, ingredients, fridge, favorites },
      source: pulled ? "mongodb" : "sqlite",
      synced_at: new Date(),
    });
  } catch (error) {
    next(error);
  }
};

const pushData = async (req, res, next) => {
  try {
    if (isMongoConnected()) {
      await syncToMongo();
    }

    const pending = sqlite.getPendingSyncItems();

    res.json({
      success: true,
      message: isMongoConnected()
        ? "Data berhasil disync ke MongoDB."
        : "Data tersimpan di SQLite, akan disync saat MongoDB tersedia.",
      pending_sync: pending.length,
      synced_at: new Date(),
    });
  } catch (error) {
    next(error);
  }
};

const getStatus = async (req, res, next) => {
  try {
    const pending = sqlite.getPendingSyncItems();

    res.json({
      success: true,
      data: {
        mongodb_connected: isMongoConnected(),
        pending_sync_items: pending.length,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { pullData, pushData, getStatus };
