const mongoose = require("mongoose");

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
    console.log("MongoDB connection failed:", error.message);
    return null;
  }
};

const isMongoConnected = () => {
  return mongoConnected && mongoose.connection.readyState === 1;
};

module.exports = { connectMongoDB, isMongoConnected };
