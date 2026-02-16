const validateApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!process.env.API_KEY) {
    return next();
  }

  if (!apiKey) {
    return res.status(403).json({
      success: false,
      message: "Akses ditolak. API key tidak ditemukan.",
    });
  }

  if (apiKey !== process.env.API_KEY) {
    return res.status(403).json({
      success: false,
      message: "Akses ditolak. API key tidak valid.",
    });
  }

  next();
};

module.exports = { validateApiKey };
