const { getSQLiteDB } = require("../config/db");

const cacheRecipe = (recipe) => {
  const db = getSQLiteDB();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO cached_recipes (mongo_id, title, description, image_url, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(
    recipe._id ? recipe._id.toString() : null,
    recipe.title,
    recipe.description || "",
    recipe.image_url || "",
    JSON.stringify(recipe)
  );
};

const cacheMultipleRecipes = (recipes) => {
  const db = getSQLiteDB();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO cached_recipes (mongo_id, title, description, image_url, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  const transaction = db.transaction((items) => {
    for (const recipe of items) {
      stmt.run(
        recipe._id ? recipe._id.toString() : null,
        recipe.title,
        recipe.description || "",
        recipe.image_url || "",
        JSON.stringify(recipe)
      );
    }
  });
  transaction(recipes);
};

const getCachedRecipes = (options = {}) => {
  const db = getSQLiteDB();
  const { category, tags, meal_type, limit = 100, offset = 0 } = options;

  let sql = "SELECT * FROM cached_recipes WHERE 1=1";
  const params = [];

  if (category) {
    sql += " AND json_extract(data_json, '$.category') = ?";
    params.push(category);
  }

  if (meal_type) {
    sql += " AND data_json LIKE ?";
    params.push(`%"${meal_type}"%`);
  }

  if (tags) {
    const tagList = tags.split(",");
    for (const tag of tagList) {
      sql += " AND data_json LIKE ?";
      params.push(`%${tag.trim()}%`);
    }
  }

  sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => JSON.parse(row.data_json));
};

const getCachedRecipeById = (mongoId) => {
  const db = getSQLiteDB();
  const row = db.prepare("SELECT data_json FROM cached_recipes WHERE mongo_id = ?").get(mongoId);
  if (!row) return null;
  return JSON.parse(row.data_json);
};

const countCachedRecipes = (options = {}) => {
  const db = getSQLiteDB();
  const { category, meal_type } = options;

  let sql = "SELECT COUNT(*) as total FROM cached_recipes WHERE 1=1";
  const params = [];

  if (category) {
    sql += " AND json_extract(data_json, '$.category') = ?";
    params.push(category);
  }

  if (meal_type) {
    sql += " AND data_json LIKE ?";
    params.push(`%"${meal_type}"%`);
  }

  const row = db.prepare(sql).get(...params);
  return row.total;
};

const searchCachedRecipes = (keyword, limit = 10) => {
  const db = getSQLiteDB();
  const pattern = `%${keyword}%`;
  const rows = db.prepare(`
    SELECT data_json FROM cached_recipes
    WHERE title LIKE ? OR description LIKE ? OR data_json LIKE ?
    ORDER BY updated_at DESC LIMIT ?
  `).all(pattern, pattern, pattern, limit);
  return rows.map((row) => JSON.parse(row.data_json));
};

const cacheMultipleIngredients = (ingredients) => {
  const db = getSQLiteDB();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO cached_ingredients (mongo_id, name, category, sub_category, unit, common_quantity, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const transaction = db.transaction((items) => {
    for (const ing of items) {
      stmt.run(
        ing._id ? ing._id.toString() : null,
        ing.name,
        ing.category,
        ing.sub_category || "",
        ing.unit || "",
        ing.common_quantity || 0
      );
    }
  });
  transaction(ingredients);
};

const getCachedIngredients = (category) => {
  const db = getSQLiteDB();
  if (category) {
    return db.prepare("SELECT * FROM cached_ingredients WHERE category = ? ORDER BY name").all(category);
  }
  return db.prepare("SELECT * FROM cached_ingredients ORDER BY category, name").all();
};

const saveFridgeItem = (item) => {
  const db = getSQLiteDB();
  const existing = db.prepare(
    "SELECT * FROM fridge_items WHERE user_id = ? AND LOWER(ingredient_name) = LOWER(?)"
  ).get(item.user_id, item.ingredient_name);

  if (existing) {
    db.prepare(`
      UPDATE fridge_items SET quantity = ?, unit = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run((existing.quantity || 0) + (item.quantity || 0), item.unit || existing.unit, existing.id);

    const updated = db.prepare("SELECT * FROM fridge_items WHERE id = ?").get(existing.id);
    return { data: updated, merged: true };
  }

  const result = db.prepare(`
    INSERT INTO fridge_items (mongo_id, user_id, ingredient_name, category, quantity, unit)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    item.mongo_id || null,
    item.user_id,
    item.ingredient_name,
    item.category,
    item.quantity || 0,
    item.unit || "gram"
  );

  const created = db.prepare("SELECT * FROM fridge_items WHERE id = ?").get(result.lastInsertRowid);
  return { data: created, merged: false };
};

const getFridgeItems = (userId, category) => {
  const db = getSQLiteDB();
  if (category) {
    return db.prepare(
      "SELECT * FROM fridge_items WHERE user_id = ? AND category = ? ORDER BY ingredient_name"
    ).all(userId, category);
  }
  return db.prepare(
    "SELECT * FROM fridge_items WHERE user_id = ? ORDER BY category, ingredient_name"
  ).all(userId);
};

const getFridgeItemById = (id, userId) => {
  const db = getSQLiteDB();
  return db.prepare("SELECT * FROM fridge_items WHERE id = ? AND user_id = ?").get(id, userId);
};

const updateFridgeItem = (id, userId, updates) => {
  const db = getSQLiteDB();
  const item = db.prepare("SELECT * FROM fridge_items WHERE id = ? AND user_id = ?").get(id, userId);
  if (!item) return null;

  const newQty = updates.quantity !== undefined ? updates.quantity : item.quantity;
  const newUnit = updates.unit !== undefined ? updates.unit : item.unit;

  db.prepare("UPDATE fridge_items SET quantity = ?, unit = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newQty, newUnit, id);

  return db.prepare("SELECT * FROM fridge_items WHERE id = ?").get(id);
};

const deleteFridgeItem = (id, userId) => {
  const db = getSQLiteDB();
  const item = db.prepare("SELECT * FROM fridge_items WHERE id = ? AND user_id = ?").get(id, userId);
  if (!item) return null;

  db.prepare("DELETE FROM fridge_items WHERE id = ?").run(id);
  return item;
};

const saveFavorite = (userId, recipeMongoId, recipeData) => {
  const db = getSQLiteDB();
  const existing = db.prepare(
    "SELECT * FROM favorites WHERE user_id = ? AND recipe_mongo_id = ?"
  ).get(userId, recipeMongoId);

  if (existing) return { data: existing, existed: true };

  const result = db.prepare(`
    INSERT INTO favorites (user_id, recipe_mongo_id, recipe_data_json)
    VALUES (?, ?, ?)
  `).run(userId, recipeMongoId, recipeData ? JSON.stringify(recipeData) : null);

  const created = db.prepare("SELECT * FROM favorites WHERE id = ?").get(result.lastInsertRowid);
  return { data: created, existed: false };
};

const getFavorites = (userId, limit = 10, offset = 0) => {
  const db = getSQLiteDB();
  const rows = db.prepare(
    "SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).all(userId, limit, offset);

  return rows.map((row) => ({
    ...row,
    recipe: row.recipe_data_json ? JSON.parse(row.recipe_data_json) : null,
  }));
};

const countFavorites = (userId) => {
  const db = getSQLiteDB();
  const row = db.prepare("SELECT COUNT(*) as total FROM favorites WHERE user_id = ?").get(userId);
  return row.total;
};

const deleteFavorite = (userId, recipeMongoId) => {
  const db = getSQLiteDB();
  const item = db.prepare(
    "SELECT * FROM favorites WHERE user_id = ? AND recipe_mongo_id = ?"
  ).get(userId, recipeMongoId);

  if (!item) return null;

  db.prepare("DELETE FROM favorites WHERE id = ?").run(item.id);
  return item;
};

const saveChatHistory = (userId, messages) => {
  const db = getSQLiteDB();
  const existing = db.prepare("SELECT * FROM chat_histories WHERE user_id = ?").get(userId);

  if (existing) {
    db.prepare("UPDATE chat_histories SET messages_json = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(messages), existing.id);
    return;
  }

  db.prepare("INSERT INTO chat_histories (user_id, messages_json) VALUES (?, ?)")
    .run(userId, JSON.stringify(messages));
};

const getChatHistory = (userId) => {
  const db = getSQLiteDB();
  const row = db.prepare("SELECT * FROM chat_histories WHERE user_id = ?").get(userId);
  if (!row) return null;
  return { ...row, messages: JSON.parse(row.messages_json) };
};

const deleteChatHistory = (userId) => {
  const db = getSQLiteDB();
  db.prepare("DELETE FROM chat_histories WHERE user_id = ?").run(userId);
};

const addToSyncQueue = (action, collectionName, documentId, userId, data) => {
  const db = getSQLiteDB();
  db.prepare(`
    INSERT INTO sync_queue (action, collection_name, document_id, user_id, data_json, synced)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(action, collectionName, documentId || "", userId || "", data ? JSON.stringify(data) : "");
};

const getPendingSyncItems = () => {
  const db = getSQLiteDB();
  const rows = db.prepare("SELECT * FROM sync_queue WHERE synced = 0 ORDER BY created_at ASC").all();
  return rows.map((row) => ({
    ...row,
    data: row.data_json ? JSON.parse(row.data_json) : null,
  }));
};

const markSynced = (ids) => {
  if (!ids || ids.length === 0) return;
  const db = getSQLiteDB();
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE sync_queue SET synced = 1 WHERE id IN (${placeholders})`).run(...ids);
};

const clearSyncedItems = () => {
  const db = getSQLiteDB();
  db.prepare("DELETE FROM sync_queue WHERE synced = 1").run();
};

const bulkLoadFridgeFromMongo = (items) => {
  const db = getSQLiteDB();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fridge_items (mongo_id, user_id, ingredient_name, category, quantity, unit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const transaction = db.transaction((list) => {
    for (const item of list) {
      stmt.run(
        item._id.toString(),
        item.user_id.toString(),
        item.ingredient_name,
        item.category,
        item.quantity || 0,
        item.unit || "gram",
        item.created_at ? new Date(item.created_at).toISOString() : new Date().toISOString()
      );
    }
  });
  transaction(items);
};

const bulkLoadFavoritesFromMongo = (favorites) => {
  const db = getSQLiteDB();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO favorites (mongo_id, user_id, recipe_mongo_id, recipe_data_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const transaction = db.transaction((list) => {
    for (const fav of list) {
      stmt.run(
        fav._id.toString(),
        fav.user_id.toString(),
        fav.recipe_id ? (fav.recipe_id._id || fav.recipe_id).toString() : "",
        fav.recipe_id && fav.recipe_id.title ? JSON.stringify(fav.recipe_id) : null,
        fav.created_at ? new Date(fav.created_at).toISOString() : new Date().toISOString()
      );
    }
  });
  transaction(favorites);
};

module.exports = {
  cacheRecipe,
  cacheMultipleRecipes,
  getCachedRecipes,
  getCachedRecipeById,
  countCachedRecipes,
  searchCachedRecipes,
  cacheMultipleIngredients,
  getCachedIngredients,
  saveFridgeItem,
  getFridgeItems,
  getFridgeItemById,
  updateFridgeItem,
  deleteFridgeItem,
  saveFavorite,
  getFavorites,
  countFavorites,
  deleteFavorite,
  saveChatHistory,
  getChatHistory,
  deleteChatHistory,
  addToSyncQueue,
  getPendingSyncItems,
  markSynced,
  clearSyncedItems,
  bulkLoadFridgeFromMongo,
  bulkLoadFavoritesFromMongo,
};
