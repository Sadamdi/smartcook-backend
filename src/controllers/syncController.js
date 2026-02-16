const { isMongoConnected } = require("../config/db");
const { syncToMongo, pullFromMongo } = require("../utils/syncService");
const { getPendingSyncItems } = require("../mysql/offline");

const pullData = async (req, res, next) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({
        success: false,
        message: "MongoDB tidak tersedia. Tidak bisa pull data.",
      });
    }

    await pullFromMongo();

    res.json({
      success: true,
      message: "Data berhasil di-pull dari MongoDB.",
    });
  } catch (error) {
    next(error);
  }
};

const pushData = async (req, res, next) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({
        success: false,
        message: "MongoDB tidak tersedia. Data akan disync otomatis saat koneksi kembali.",
      });
    }

    await syncToMongo();

    res.json({
      success: true,
      message: "Data berhasil di-push ke MongoDB.",
    });
  } catch (error) {
    next(error);
  }
};

const getStatus = async (req, res, next) => {
  try {
    const pendingItems = await getPendingSyncItems();

    res.json({
      success: true,
      data: {
        mongo_connected: isMongoConnected(),
        pending_sync: pendingItems.length,
        last_check: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { pullData, pushData, getStatus };
