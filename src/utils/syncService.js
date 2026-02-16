const { isMongoConnected } = require("../config/db");
const { getPendingSyncItems, markSynced, cacheMultipleRecipes } = require("../mysql/offline");
const FridgeItem = require("../models/FridgeItem");
const Favorite = require("../models/Favorite");
const ChatHistory = require("../models/ChatHistory");
const Recipe = require("../models/Recipe");
const Ingredient = require("../models/Ingredient");

let syncInterval = null;

const startSyncScheduler = (interval) => {
  if (syncInterval) {
    clearInterval(syncInterval);
  }

  syncInterval = setInterval(async () => {
    if (isMongoConnected()) {
      try {
        await syncToMongo();
      } catch (error) {
        console.log("Sync error:", error.message);
      }
    }
  }, interval);

  console.log(`Sync scheduler started (interval: ${interval}ms)`);
};

const syncToMongo = async () => {
  if (!isMongoConnected()) return;

  const pendingItems = await getPendingSyncItems();
  if (pendingItems.length === 0) return;

  const syncedIds = [];

  for (const item of pendingItems) {
    try {
      const data = item.data_json ? JSON.parse(item.data_json) : null;

      if (item.collection_name === "fridge") {
        await syncFridgeItem(item.action, item.document_id, item.user_id, data);
      } else if (item.collection_name === "favorites") {
        await syncFavorite(item.action, item.document_id, item.user_id, data);
      } else if (item.collection_name === "chat") {
        await syncChat(item.action, item.user_id, data);
      }

      syncedIds.push(item.id);
    } catch (error) {
      console.log(`Sync failed for item ${item.id}:`, error.message);
    }
  }

  if (syncedIds.length > 0) {
    await markSynced(syncedIds);
    console.log(`Synced ${syncedIds.length} items to MongoDB`);
  }
};

const syncFridgeItem = async (action, docId, userId, data) => {
  if (action === "create" && data) {
    await FridgeItem.create({
      user_id: userId,
      ingredient_name: data.ingredient_name,
      category: data.category,
      quantity: data.quantity,
      unit: data.unit,
      expired_date: data.expired_date || null,
    });
  } else if (action === "update" && docId) {
    await FridgeItem.findByIdAndUpdate(docId, data);
  } else if (action === "delete" && docId) {
    await FridgeItem.findByIdAndDelete(docId);
  }
};

const syncFavorite = async (action, docId, userId, data) => {
  if (action === "create" && data) {
    const existing = await Favorite.findOne({ user_id: userId, recipe_id: data.recipe_id });
    if (!existing) {
      await Favorite.create({ user_id: userId, recipe_id: data.recipe_id });
    }
  } else if (action === "delete" && data) {
    await Favorite.findOneAndDelete({ user_id: userId, recipe_id: data.recipe_id });
  }
};

const syncChat = async (action, userId, data) => {
  if (action === "update" && data) {
    await ChatHistory.findOneAndUpdate(
      { user_id: userId },
      { messages: data.messages, updated_at: new Date() },
      { upsert: true }
    );
  } else if (action === "delete") {
    await ChatHistory.findOneAndDelete({ user_id: userId });
  }
};

const pullFromMongo = async () => {
  if (!isMongoConnected()) return;

  try {
    const recipes = await Recipe.find().sort({ created_at: -1 }).limit(100);
    if (recipes.length > 0) {
      await cacheMultipleRecipes(recipes);
    }
    console.log(`Pulled ${recipes.length} recipes from MongoDB`);
  } catch (error) {
    console.log("Pull from MongoDB failed:", error.message);
  }
};

const stopSyncScheduler = () => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
};

module.exports = {
  startSyncScheduler,
  syncToMongo,
  pullFromMongo,
  stopSyncScheduler,
};
