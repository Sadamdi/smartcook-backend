const logEvent = (event, payload = {}, level = "info") => {
  const ts = new Date().toISOString();
  const base = { ts, level, event, ...payload };
  try {
    console.log(JSON.stringify(base));
  } catch (e) {
    console.log(
      JSON.stringify({
        ts,
        level: "error",
        event: "log_serialize_error",
      }),
    );
  }
};

const buildRequestContext = (req) => {
  const ip = req.headers["x-forwarded-for"] || req.ip;
  const userAgent = req.headers["user-agent"] || "";
  const method = req.method;
  const path = req.originalUrl || req.url;
  const userId = req.user && req.user._id ? req.user._id.toString() : undefined;
  const email =
    req.user && req.user.email ? req.user.email : undefined;
  return { ip, userAgent, method, path, userId, email };
};

module.exports = { logEvent, buildRequestContext };

