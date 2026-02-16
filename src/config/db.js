const mongoose = require("mongoose");
const Database = require("better-sqlite3");
const path = require("path");

let sqliteDb;
let mongoConnected = false;

const connectMongoDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    mongoConnected = true;
    console.log(`MongoDB connected: ${conn.connection.host}`);

    mongoose.connection.on("disconnected", () => {
      mongoConnected = false;
      console.log("MongoDB disconnected");
    });

    mongoose.connection.on("reconnected", () => {
      mongoConnected = true;
      console.log("MongoDB reconnected");
    });

    return conn;
  } catch (error) {
    mongoConnected = false;
    console.log("MongoDB connection failed, running in SQLite-only mode");
    return null;
  }
};

const isMongoConnected = () => {
  return mongoConnected && mongoose.connection.readyState === 1;
};

const getSQLiteDB = () => {
  if (!sqliteDb) {
    const dbPath = path.join(__dirname, "..", "sqlite", "smartcook.db");
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma("journal_mode = WAL");
    sqliteDb.pragma("foreign_keys = ON");
    initSQLiteTables(sqliteDb);
  }
  return sqliteDb;
};

const initSQLiteTables = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cached_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mongo_id TEXT UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      data_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cached_ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mongo_id TEXT UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      sub_category TEXT DEFAULT '',
      unit TEXT,
      common_quantity REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fridge_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mongo_id TEXT,
      user_id TEXT NOT NULL,
      ingredient_name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity REAL DEFAULT 0,
      unit TEXT DEFAULT 'gram',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mongo_id TEXT,
      user_id TEXT NOT NULL,
      recipe_mongo_id TEXT NOT NULL,
      recipe_data_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_histories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      messages_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      document_id TEXT,
      user_id TEXT,
      data_json TEXT,
      synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_fridge_user ON fridge_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_fridge_user_cat ON fridge_items(user_id, category);
    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_sync_synced ON sync_queue(synced);
    CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_histories(user_id);
  `);
};

const closeSQLiteDB = () => {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
};

module.exports = { connectMongoDB, isMongoConnected, getSQLiteDB, closeSQLiteDB };
