const mongoose = require("mongoose");
const mysql = require("mysql2/promise");

let mysqlPool;
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
    console.log("MongoDB connection failed, running in MySQL-only mode");
    return null;
  }
};

const isMongoConnected = () => {
  return mongoConnected && mongoose.connection.readyState === 1;
};

const getMySQLPool = async () => {
  if (!mysqlPool) {
    mysqlPool = mysql.createPool({
      host: process.env.MYSQL_HOST || "localhost",
      port: parseInt(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "smartcook",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    await initMySQLTables();
  }
  return mysqlPool;
};

const initMySQLTables = async () => {
  const pool = mysqlPool;

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS cached_recipes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      mongo_id VARCHAR(24) UNIQUE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      image_url TEXT,
      data_json LONGTEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS cached_ingredients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      mongo_id VARCHAR(24) UNIQUE,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(50) NOT NULL,
      sub_category VARCHAR(100) DEFAULT '',
      unit VARCHAR(50),
      common_quantity DOUBLE DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fridge_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      mongo_id VARCHAR(24),
      user_id VARCHAR(24) NOT NULL,
      ingredient_name VARCHAR(255) NOT NULL,
      category VARCHAR(50) NOT NULL,
      quantity DOUBLE DEFAULT 0,
      unit VARCHAR(50) DEFAULT 'gram',
      expired_date DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_fridge_user (user_id),
      INDEX idx_fridge_user_cat (user_id, category)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INT AUTO_INCREMENT PRIMARY KEY,
      mongo_id VARCHAR(24),
      user_id VARCHAR(24) NOT NULL,
      recipe_mongo_id VARCHAR(24) NOT NULL,
      recipe_data_json LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_favorites_user (user_id)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS chat_histories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(24) NOT NULL UNIQUE,
      messages_json LONGTEXT DEFAULT ('[]'),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_chat_user (user_id)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      action VARCHAR(50) NOT NULL,
      collection_name VARCHAR(100) NOT NULL,
      document_id VARCHAR(24),
      user_id VARCHAR(24),
      data_json LONGTEXT,
      synced TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sync_synced (synced)
    )
  `);
};

const closeMySQLPool = async () => {
  if (mysqlPool) {
    await mysqlPool.end();
    mysqlPool = null;
  }
};

module.exports = { connectMongoDB, isMongoConnected, getMySQLPool, closeMySQLPool };
