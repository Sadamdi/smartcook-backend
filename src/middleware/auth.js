const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { legacyWindowOpen, looksLikeJwt } = require("./authToken");
const { suspended } = require("../modules/ops/restrictions");

/**
 * Reads the *user* JWT (the one issued by login/register/Google sign-in).
 *
 * It no longer lives in `Authorization`, because that header now carries the
 * app session token minted by the handshake. The user JWT arrives as
 * `X-User-Token`.
 *
 * Builds released before 1.0.4 still put the user JWT in `Authorization` and
 * had no app session at all. Inside the compatibility window we keep reading
 * that header so an older install is not bounced to the login screen in a
 * loop; it starts sending `X-User-Token` after it auto-updates.
 */
const readUserToken = (req) => {
  const headerToken = req.headers["x-user-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }

  if (legacyWindowOpen()) {
    const auth = req.headers.authorization;
    if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
      const value = auth.slice(7).trim();
      // App tokens are opaque base64url; user tokens are JWTs (three segments).
      if (looksLikeJwt(value)) return value;
    }
  }
  return null;
};

const protect = async (req, res, next) => {
  try {
    const token = readUserToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        code: "USER_TOKEN_MISSING",
        message: "Akses ditolak. Silakan masuk kembali.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        code: "USER_TOKEN_INVALID",
        message: "Silakan masuk kembali.",
      });
    }

    // A suspended account stops working on its next request.
    if (await suspended(res, user.email)) return;

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        code: "USER_TOKEN_INVALID",
        message: "Sesi tidak valid. Silakan masuk kembali.",
      });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        code: "USER_TOKEN_EXPIRED",
        message: "Sesi habis. Silakan masuk kembali.",
      });
    }
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

module.exports = { protect };
