const { isMongoConnected } = require("../config/db");
const {
  getPendingSyncItems,
  markSynced,
  clearSyncedItems,
  cacheMultipleRecipes,
  cacheMultipleIngredients,
  bulkLoadFridgeFromMongo,
  bulkLoadFavoritesFromMongo,
} = require("../sqlite/offline");

let syncInterval = null;

const syncToMongo = async () => {
  if (!isMongoConnected()) return;

  const pending = getPendingSyncItems();
  if (pending.length === 0) return;

  const FridgeItem = require("../models/FridgeItem");
  const Favorite = require("../models/Favorite");
  const ChatHistory = require("../models/ChatHistory");

  const syncedIds = [];

  for (const item of pending) {
    try {
      if (item.collection_name === "fridge") {
        if (item.action === "create") {
          const data = item.data;
          const existing = await FridgeItem.findOne({
            user_id: item.user_id,
            ingredient_name: { $regex: new RegExp(`^${data.ingredient_name}$`, "i") },
          });
          if (existing) {
            existing.quantity = data.quantity;
            existing.unit = data.unit;
            await existing.save();
          } else {
            await FridgeItem.create({ ...data, user_id: item.user_id });
          }
        } else if (item.action === "update" && item.document_id) {
          await FridgeItem.findByIdAndUpdate(item.document_id, item.data);
        } else if (item.action === "delete" && item.document_id) {
          await FridgeItem.findByIdAndDelete(item.document_id);
        }
      }

      if (item.collection_name === "favorites") {
        if (item.action === "create" && item.data) {
          const existing = await Favorite.findOne({
            user_id: item.user_id,
            recipe_id: item.data.recipe_id,
          });
          if (!existing) {
            await Favorite.create({
              user_id: item.user_id,
              recipe_id: item.data.recipe_id,
            });
          }
        } else if (item.action === "delete" && item.data) {
          await Favorite.findOneAndDelete({
            user_id: item.user_id,
            recipe_id: item.data.recipe_id,
          });
        }
      }

      if (item.collection_name === "chat") {
        if (item.action === "update" && item.data) {
          const existing = await ChatHistory.findOne({ user_id: item.user_id });
          if (existing) {
            existing.messages = item.data.messages;
            await existing.save();
          } else {
            await ChatHistory.create({
              user_id: item.user_id,
              messages: item.data.messages,
            });
          }
        } else if (item.action === "delete") {
          await ChatHistory.findOneAndDelete({ user_id: item.user_id });
        }
      }

      syncedIds.push(item.id);
    } catch (e) {
      console.error(`Sync failed for item ${item.id}:`, e.message);
    }
  }

  if (syncedIds.length > 0) {
    markSynced(syncedIds);
    clearSyncedItems();
    console.log(`Synced ${syncedIds.length}/${pending.length} items to MongoDB`);
  }
};

const pullFromMongo = async (userId) => {
  if (!isMongoConnected()) return false;

  try {
    const Recipe = require("../models/Recipe");
    const Ingredient = require("../models/Ingredient");

    const recipes = await Recipe.find({}).limit(200);
    if (recipes.length > 0) {
      cacheMultipleRecipes(recipes);
    }

    const ingredients = await Ingredient.find({});
    if (ingredients.length > 0) {
      cacheMultipleIngredients(ingredients);
    }

    if (userId) {
      const FridgeItem = require("../models/FridgeItem");
      const Favorite = require("../models/Favorite");

      const fridgeItems = await FridgeItem.find({ user_id: userId });
      if (fridgeItems.length > 0) {
        bulkLoadFridgeFromMongo(fridgeItems);
      }

      const favorites = await Favorite.find({ user_id: userId }).populate("recipe_id");
      if (favorites.length > 0) {
        bulkLoadFavoritesFromMongo(favorites);
      }
    }

    return true;
  } catch (e) {
    console.error("Pull from MongoDB failed:", e.message);
    return false;
  }
};

const startSyncScheduler = (intervalMs = 30000) => {
  if (syncInterval) return;

  syncInterval = setInterval(async () => {
    try {
      await syncToMongo();
    } catch (e) {
      console.error("Sync scheduler error:", e.message);
    }
  }, intervalMs);

  console.log(`Sync scheduler started (every ${intervalMs / 1000}s)`);
};

const stopSyncScheduler = () => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
};

module.exports = {
  syncToMongo,
  pullFromMongo,
  startSyncScheduler,
  stopSyncScheduler,
};
