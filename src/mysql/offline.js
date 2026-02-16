const { getMySQLPool } = require("../config/db");

const getCachedRecipes = async (options = {}) => {
  const pool = await getMySQLPool();
  if (!pool) return [];
  const { category, tags, meal_type, limit = 10, offset = 0 } = options;

  let query = "SELECT * FROM cached_recipes WHERE 1=1";
  const params = [];

  if (category) {
    query += " AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.category')) = ?";
    params.push(category);
  }

  if (meal_type) {
    query += " AND JSON_CONTAINS(data_json, ?, '$.meal_type')";
    params.push(JSON.stringify(meal_type));
  }

  if (tags) {
    const tagList = typeof tags === "string" ? tags.split(",") : tags;
    for (const tag of tagList) {
      query += " AND JSON_CONTAINS(data_json, ?, '$.tags')";
      params.push(JSON.stringify(tag));
    }
  }

  query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const [rows] = await pool.execute(query, params);
  return rows.map((row) => {
    const data = JSON.parse(row.data_json);
    data._id = row.mongo_id;
    return data;
  });
};

const getCachedRecipeById = async (id) => {
  const pool = await getMySQLPool();
  if (!pool) return null;
  const [rows] = await pool.execute(
    "SELECT * FROM cached_recipes WHERE mongo_id = ?",
    [id]
  );
  if (rows.length === 0) return null;
  const data = JSON.parse(rows[0].data_json);
  data._id = rows[0].mongo_id;
  return data;
};

const countCachedRecipes = async (options = {}) => {
  const pool = await getMySQLPool();
  if (!pool) return 0;
  const { category, meal_type } = options;

  let query = "SELECT COUNT(*) as total FROM cached_recipes WHERE 1=1";
  const params = [];

  if (category) {
    query += " AND JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.category')) = ?";
    params.push(category);
  }

  if (meal_type) {
    query += " AND JSON_CONTAINS(data_json, ?, '$.meal_type')";
    params.push(JSON.stringify(meal_type));
  }

  const [rows] = await pool.execute(query, params);
  return rows[0].total;
};

const searchCachedRecipes = async (query, limit = 10) => {
  const pool = await getMySQLPool();
  if (!pool) return [];
  const searchTerm = `%${query}%`;
  const [rows] = await pool.execute(
    "SELECT * FROM cached_recipes WHERE title LIKE ? OR description LIKE ? LIMIT ?",
    [searchTerm, searchTerm, limit]
  );
  return rows.map((row) => {
    const data = JSON.parse(row.data_json);
    data._id = row.mongo_id;
    return data;
  });
};

const cacheRecipe = async (recipe) => {
  const pool = await getMySQLPool();
  if (!pool) return;
  const mongoId = recipe._id ? recipe._id.toString() : null;
  const dataJson = JSON.stringify(recipe.toObject ? recipe.toObject() : recipe);

  await pool.execute(
    `INSERT INTO cached_recipes (mongo_id, title, description, image_url, data_json)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description),
     image_url = VALUES(image_url), data_json = VALUES(data_json)`,
    [mongoId, recipe.title || "", recipe.description || "", recipe.image_url || "", dataJson]
  );
};

const cacheMultipleRecipes = async (recipes) => {
  for (const recipe of recipes) {
    await cacheRecipe(recipe);
  }
};

const getFridgeItems = async (userId, category) => {
  const pool = await getMySQLPool();
  if (!pool) return [];
  let query = "SELECT * FROM fridge_items WHERE user_id = ?";
  const params = [userId];

  if (category) {
    query += " AND category = ?";
    params.push(category);
  }

  query += " ORDER BY category ASC, ingredient_name ASC";

  const [rows] = await pool.execute(query, params);
  return rows;
};

const saveFridgeItem = async (data) => {
  const pool = await getMySQLPool();
  if (!pool) throw new Error("MySQL unavailable");
  const [existing] = await pool.execute(
    "SELECT * FROM fridge_items WHERE user_id = ? AND ingredient_name = ? AND category = ?",
    [data.user_id, data.ingredient_name, data.category]
  );

  if (existing.length > 0) {
    const newQty = existing[0].quantity + (data.quantity || 0);
    await pool.execute(
      "UPDATE fridge_items SET quantity = ? WHERE id = ?",
      [newQty, existing[0].id]
    );
    const [updated] = await pool.execute("SELECT * FROM fridge_items WHERE id = ?", [existing[0].id]);
    return { merged: true, data: updated[0] };
  }

  const [result] = await pool.execute(
    `INSERT INTO fridge_items (user_id, ingredient_name, category, quantity, unit, expired_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [data.user_id, data.ingredient_name, data.category, data.quantity || 0, data.unit || "gram", data.expired_date || null]
  );

  const [inserted] = await pool.execute("SELECT * FROM fridge_items WHERE id = ?", [result.insertId]);
  return { merged: false, data: inserted[0] };
};

const updateFridgeItem = async (id, userId, updates) => {
  const pool = await getMySQLPool();
  if (!pool) return null;
  const [existing] = await pool.execute(
    "SELECT * FROM fridge_items WHERE id = ? AND user_id = ?",
    [id, userId]
  );

  if (existing.length === 0) return null;

  const fields = [];
  const params = [];

  if (updates.quantity !== undefined) {
    fields.push("quantity = ?");
    params.push(updates.quantity);
  }
  if (updates.unit !== undefined) {
    fields.push("unit = ?");
    params.push(updates.unit);
  }
  if (updates.expired_date !== undefined) {
    fields.push("expired_date = ?");
    params.push(updates.expired_date);
  }

  if (fields.length === 0) return existing[0];

  params.push(id, userId);
  await pool.execute(
    `UPDATE fridge_items SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
    params
  );

  const [updated] = await pool.execute("SELECT * FROM fridge_items WHERE id = ?", [id]);
  return updated[0];
};

const deleteFridgeItem = async (id, userId) => {
  const pool = await getMySQLPool();
  if (!pool) return null;
  const [existing] = await pool.execute(
    "SELECT * FROM fridge_items WHERE id = ? AND user_id = ?",
    [id, userId]
  );

  if (existing.length === 0) return null;

  await pool.execute("DELETE FROM fridge_items WHERE id = ? AND user_id = ?", [id, userId]);
  return existing[0];
};

const bulkLoadFridgeFromMongo = async (mongoItems) => {
  const pool = await getMySQLPool();
  if (!pool) return;
  for (const item of mongoItems) {
    const obj = item.toObject ? item.toObject() : item;
    await pool.execute(
      `INSERT INTO fridge_items (mongo_id, user_id, ingredient_name, category, quantity, unit, expired_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), unit = VALUES(unit), expired_date = VALUES(expired_date)`,
      [
        obj._id.toString(),
        obj.user_id.toString(),
        obj.ingredient_name,
        obj.category,
        obj.quantity || 0,
        obj.unit || "gram",
        obj.expired_date || null,
      ]
    );
  }
};

const getFavorites = async (userId, limit = 10, offset = 0) => {
  const pool = await getMySQLPool();
  if (!pool) return [];
  const [rows] = await pool.execute(
    "SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [userId, limit, offset]
  );
  return rows.map((row) => ({
    id: row.id,
    _id: row.id,
    recipe_mongo_id: row.recipe_mongo_id,
    recipe: row.recipe_data_json ? JSON.parse(row.recipe_data_json) : null,
    created_at: row.created_at,
  }));
};

const countFavorites = async (userId) => {
  const pool = await getMySQLPool();
  if (!pool) return 0;
  const [rows] = await pool.execute(
    "SELECT COUNT(*) as total FROM favorites WHERE user_id = ?",
    [userId]
  );
  return rows[0].total;
};

const saveFavorite = async (userId, recipeId, recipeData) => {
  const pool = await getMySQLPool();
  if (!pool) throw new Error("MySQL unavailable");
  const [existing] = await pool.execute(
    "SELECT * FROM favorites WHERE user_id = ? AND recipe_mongo_id = ?",
    [userId, recipeId]
  );

  if (existing.length > 0) {
    return { existed: true, data: existing[0] };
  }

  const recipeJson = JSON.stringify(recipeData.toObject ? recipeData.toObject() : recipeData);

  const [result] = await pool.execute(
    "INSERT INTO favorites (user_id, recipe_mongo_id, recipe_data_json) VALUES (?, ?, ?)",
    [userId, recipeId, recipeJson]
  );

  const [inserted] = await pool.execute("SELECT * FROM favorites WHERE id = ?", [result.insertId]);
  return { existed: false, data: inserted[0] };
};

const deleteFavorite = async (userId, recipeId) => {
  const pool = await getMySQLPool();
  if (!pool) return false;
  const [existing] = await pool.execute(
    "SELECT * FROM favorites WHERE user_id = ? AND recipe_mongo_id = ?",
    [userId, recipeId]
  );

  if (existing.length === 0) return false;

  await pool.execute(
    "DELETE FROM favorites WHERE user_id = ? AND recipe_mongo_id = ?",
    [userId, recipeId]
  );

  return true;
};

const bulkLoadFavoritesFromMongo = async (mongoFavorites) => {
  const pool = await getMySQLPool();
  if (!pool) return;
  for (const fav of mongoFavorites) {
    const obj = fav.toObject ? fav.toObject() : fav;
    const recipeData = obj.recipe_id ? JSON.stringify(obj.recipe_id.toObject ? obj.recipe_id.toObject() : obj.recipe_id) : null;
    const recipeMongoId = obj.recipe_id && obj.recipe_id._id ? obj.recipe_id._id.toString() : (obj.recipe_id ? obj.recipe_id.toString() : null);

    await pool.execute(
      `INSERT INTO favorites (mongo_id, user_id, recipe_mongo_id, recipe_data_json)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE recipe_data_json = VALUES(recipe_data_json)`,
      [obj._id.toString(), obj.user_id.toString(), recipeMongoId, recipeData]
    );
  }
};

const getChatHistory = async (userId) => {
  const pool = await getMySQLPool();
  if (!pool) return null;
  const [rows] = await pool.execute(
    "SELECT * FROM chat_histories WHERE user_id = ?",
    [userId]
  );
  if (rows.length === 0) return null;
  return {
    messages: JSON.parse(rows[0].messages_json || "[]"),
    created_at: rows[0].created_at,
    updated_at: rows[0].updated_at,
  };
};

const saveChatHistory = async (userId, messages) => {
  const pool = await getMySQLPool();
  if (!pool) throw new Error("MySQL unavailable");
  const messagesJson = JSON.stringify(messages);

  await pool.execute(
    `INSERT INTO chat_histories (user_id, messages_json)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE messages_json = VALUES(messages_json)`,
    [userId, messagesJson]
  );
};

const deleteChatHistory = async (userId) => {
  const pool = await getMySQLPool();
  if (!pool) return;
  await pool.execute("DELETE FROM chat_histories WHERE user_id = ?", [userId]);
};

const addToSyncQueue = async (action, collectionName, docId, userId, data) => {
  const pool = await getMySQLPool();
  if (!pool) return;
  const dataJson = data ? JSON.stringify(data) : null;

  await pool.execute(
    `INSERT INTO sync_queue (action, collection_name, document_id, user_id, data_json)
     VALUES (?, ?, ?, ?, ?)`,
    [action, collectionName, docId, userId, dataJson]
  );
};

const getPendingSyncItems = async () => {
  const pool = await getMySQLPool();
  if (!pool) return [];
  const [rows] = await pool.execute(
    "SELECT * FROM sync_queue WHERE synced = 0 ORDER BY created_at ASC"
  );
  return rows;
};

const markSynced = async (ids) => {
  if (!ids || ids.length === 0) return;
  const pool = await getMySQLPool();
  if (!pool) return;
  const placeholders = ids.map(() => "?").join(",");
  await pool.execute(
    `UPDATE sync_queue SET synced = 1 WHERE id IN (${placeholders})`,
    ids
  );
};

module.exports = {
  getCachedRecipes,
  getCachedRecipeById,
  countCachedRecipes,
  searchCachedRecipes,
  cacheRecipe,
  cacheMultipleRecipes,
  getFridgeItems,
  saveFridgeItem,
  updateFridgeItem,
  deleteFridgeItem,
  bulkLoadFridgeFromMongo,
  getFavorites,
  countFavorites,
  saveFavorite,
  deleteFavorite,
  bulkLoadFavoritesFromMongo,
  getChatHistory,
  saveChatHistory,
  deleteChatHistory,
  addToSyncQueue,
  getPendingSyncItems,
  markSynced,
};
