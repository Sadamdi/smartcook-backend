const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  if (err.name === "ValidationError") {
    statusCode = 400;
    const messages = Object.values(err.errors).map((e) => e.message);
    message = messages.join(", ");
  }

  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue)[0];
    message = `${field} sudah digunakan.`;
  }

  if (err.name === "CastError") {
    statusCode = 400;
    message = "ID tidak valid.";
  }

  if (statusCode >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl} -> ${statusCode}:`, err.stack || err.message);
    // Do not hand internals (driver errors, paths) to clients in production.
    if (process.env.NODE_ENV === "production") message = "Terjadi kesalahan pada server.";
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
