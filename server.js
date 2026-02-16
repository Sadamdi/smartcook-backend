require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { connectMongoDB, getSQLiteDB, isMongoConnected } = require("./src/config/db");
const { initGemini } = require("./src/config/gemini");
const { errorHandler } = require("./src/middleware/errorHandler");
const { validateApiKey } = require("./src/middleware/apiKey");
const { startSyncScheduler, syncToMongo } = require("./src/utils/syncService");

const authRoutes = require("./src/routes/auth");
const userRoutes = require("./src/routes/user");
const recipeRoutes = require("./src/routes/recipe");
const fridgeRoutes = require("./src/routes/fridge");
const favoriteRoutes = require("./src/routes/favorite");
const chatRoutes = require("./src/routes/chat");
const categoryRoutes = require("./src/routes/category");
const syncRoutes = require("./src/routes/sync");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/", validateApiKey);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: "Terlalu banyak request. Coba lagi nanti." },
});
app.use("/api/", limiter);

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Terlalu banyak pesan. Tunggu sebentar." },
});
app.use("/api/chat", chatLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/fridge", fridgeRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/sync", syncRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "SmartCook API is running",
    timestamp: new Date(),
    environment: process.env.NODE_ENV || "development",
    mongodb: isMongoConnected() ? "connected" : "disconnected",
  });
});

app.use("*", (req, res) => {
  res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    getSQLiteDB();
    console.log("SQLite initialized successfully (primary storage)");

    const mongoConn = await connectMongoDB();
    if (mongoConn) {
      console.log("MongoDB connected successfully (backup storage)");
      startSyncScheduler(parseInt(process.env.SYNC_INTERVAL) || 30000);
    } else {
      console.log("Running in SQLite-only mode. MongoDB will sync when available.");

      setInterval(async () => {
        if (!isMongoConnected()) {
          try {
            await connectMongoDB();
            if (isMongoConnected()) {
              console.log("MongoDB reconnected! Starting sync...");
              startSyncScheduler(parseInt(process.env.SYNC_INTERVAL) || 30000);
              await syncToMongo();
            }
          } catch (e) {}
        }
      }, 60000);
    }

    initGemini();
    console.log("Gemini AI initialized successfully");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`SmartCook API running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
      if (process.env.API_KEY) {
        console.log("API Key protection: ENABLED");
      } else {
        console.log("API Key protection: DISABLED (set API_KEY in .env to enable)");
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
