require('dotenv').config();
require('./src/utils/redact').installConsoleRedaction();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { connectMongoDB, isMongoConnected } = require('./src/config/db');
const { initGemini } = require('./src/config/gemini');
const { errorHandler } = require('./src/middleware/errorHandler');
const { logEvent, buildRequestContext } = require('./src/utils/logger');
const { ipKey, sessionKey } = require('./src/utils/rateLimitKey');
const { authToken, legacyDeadlineInfo } = require('./src/middleware/authToken');
const {
	assertConfigured,
	keyIndex,
	lastRotatedAt,
	accessTtlSeconds,
	refreshTtlSeconds,
} = require('./src/modules/app-tokens/schema');

// Optional Google OAuth client allowlist (comma-separated). Defaults to
// empty so the server still boots without it, but the auth path will log
// a warning so it's obvious when Google sign-in is unverifiable.
const GOOGLE_CLIENT_IDS = (process.env.GOOGLE_CLIENT_IDS || '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const GOOGLE_WEB_CLIENT_ID = (process.env.GOOGLE_WEB_CLIENT_ID || '').trim();
if (GOOGLE_CLIENT_IDS.length === 0) {
	console.warn(
		'[Google Sign-In] GOOGLE_CLIENT_IDS belum diset. Verifikasi idToken akan menerima audience apa pun (fallback).',
	);
} else {
	console.log(
		`[Google Sign-In] GOOGLE_CLIENT_IDS aktif untuk ${GOOGLE_CLIENT_IDS.length} client.`,
	);
}
if (!GOOGLE_WEB_CLIENT_ID) {
	console.warn(
		'[Google Sign-In] GOOGLE_WEB_CLIENT_ID belum diset. Web client OAuth tidak akan diverifikasi.',
	);
} else {
	console.log(
		`[Google Sign-In] GOOGLE_WEB_CLIENT_ID aktif: ${GOOGLE_WEB_CLIENT_ID.slice(0, 12)}...`,
	);
}

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/user');
const recipeRoutes = require('./src/routes/recipe');
const fridgeRoutes = require('./src/routes/fridge');
const favoriteRoutes = require('./src/routes/favorite');
const chatRoutes = require('./src/routes/chat');
const categoryRoutes = require('./src/routes/category');
const ingredientRoutes = require('./src/routes/ingredient');
const appRoutes = require('./src/modules/app/routes');
const helpRoutes = require('./src/modules/help/routes');
const devLogRoutes = require('./src/modules/devlog/routes');

const app = express();

// The API sits behind a Cloudflare Tunnel, so every request arrives with
// `X-Forwarded-For` holding a chain of proxies. express-rate-limit refuses to
// trust that chain unless `trust proxy` says how many hops to expect, and it
// throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR otherwise - which turns every
// rate-limited route into a 500. One hop is the tunnel.
app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// End-to-end encrypted channel: opens POST /api/secure, rewrites it into the
// real request and seals the answer. Must run after the body parser and
// BEFORE the access gate and every router, so they all see the inner request.
// Plaintext still works until API_REQUIRE_ENCRYPTED=1 (see
// src/modules/secure/channel.js).
app.use(require('./src/modules/secure/channel').middleware());

// ---------------------------------------------------------------------------
// Access gate.
//
// Previously every endpoint required the static `x-api-key` header. That
// value shipped inside the APK, so anyone who unpacked it could replay it
// forever. It is replaced by a double-token scheme:
//
//   access token  (24 h default)  -> `Authorization: Bearer <access>`
//   refresh token (7 d default)  -> POST /api/auth/refresh
//
// A session only exists if a release-signed app presented its APK
// certificate to POST /api/auth/handshake. Tokens are opaque random strings
// stored hashed in MongoDB, so they cannot be forged or decoded.
//
// Two families stay outside this gate on purpose:
//   - /api/app/*       the auto-update endpoints. They run before any login
//                      and authenticate with their own cert gate + a short
//                      HMAC download token.
//   - /api/auth/handshake, /api/auth/refresh
//                      the bootstrap/renewal paths themselves.
//   - /api/health      liveness probe for monitoring; exposes no user data.
// ---------------------------------------------------------------------------
const OPEN_PATHS = new Set([
  '/api/health',
  '/api/auth/handshake',
  '/api/auth/refresh',
  // Developer debug log. It must be reachable before a session exists: a
  // launch crash happens before the handshake completes, and that is exactly
  // the report we need. The route attaches identity itself when a token is
  // present, and stores the event anonymously when it is not.
  '/api/devlog/ingest',
]);

const isBootstrapRequest = (req) => {
  // This middleware is mounted at the app root, so `req.path` still carries
  // the full /api/... prefix here.
  if (req.method === 'GET' && req.path.startsWith('/api/app/')) return true;
  return OPEN_PATHS.has(req.path);
};

app.use((req, res, next) => {
  if (isBootstrapRequest(req)) return next();
  return authToken(req, res, next);
});

const formatRetryAfter = (ms) => {
	const seconds = Math.ceil(ms / 1000);
	if (seconds < 60) {
		return `${seconds} detik`;
	}
	const minutes = Math.ceil(seconds / 60);
	return `${minutes} menit`;
};

const limiter = rateLimit({
	windowMs: 1 * 60 * 1000,
	max: 1000,
	standardHeaders: true,
	legacyHeaders: false,
	handler: (req, res, next, options) => {
		const rateLimitInfo = req.rateLimit || {};
		const resetTime = rateLimitInfo.resetTime
			? new Date(rateLimitInfo.resetTime)
			: new Date(Date.now() + options.windowMs);
		const retryAfterMs = Math.max(0, resetTime.getTime() - Date.now());
		const retryAfter = formatRetryAfter(retryAfterMs);

		const ctx = buildRequestContext(req);
		logEvent('rate_limit_hit', {
			...ctx,
			success: false,
			statusCode: 429,
			limit: options.max,
			windowMs: options.windowMs,
			retryAfterMs,
			retryAfter,
			resetTime: resetTime.toISOString(),
		});

		res.status(429).json({
			success: false,
			message: `Terlalu banyak request. Coba lagi dalam ${retryAfter}.`,
			retryAfter,
			retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
			resetTime: resetTime.toISOString(),
		});
	},
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 40,
	standardHeaders: true,
	legacyHeaders: false,
	keyGenerator: ipKey,
	validate: { xForwardedForHeader: false },
	handler: (req, res) => {
		res.status(429).json({
			success: false,
			code: 'AUTH_RATE_LIMITED',
			message: 'Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.',
		});
	},
});
// login/otp endpoints have their own 5-per-5-min rule inside the controller;
// this wider cap is the outer net that stops credential-stuffing traffic.
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

const chatLimiter = rateLimit({
	windowMs: 1 * 60 * 1000,
	max: 20,
	standardHeaders: true,
	legacyHeaders: false,
	// Key on the account, not the IP: otherwise everyone behind one carrier
	// NAT shares a single budget, and a leaked JWT can be replayed from any
	// address until the IP window clears.
	keyGenerator: sessionKey,
	validate: { xForwardedForHeader: false },
	handler: (req, res, next, options) => {
		const rateLimitInfo = req.rateLimit || {};
		const resetTime = rateLimitInfo.resetTime
			? new Date(rateLimitInfo.resetTime)
			: new Date(Date.now() + options.windowMs);
		const retryAfterMs = Math.max(0, resetTime.getTime() - Date.now());
		const retryAfter = formatRetryAfter(retryAfterMs);

		const ctx = buildRequestContext(req);
		logEvent('rate_limit_hit', {
			...ctx,
			success: false,
			statusCode: 429,
			limit: options.max,
			windowMs: options.windowMs,
			retryAfterMs,
			retryAfter,
			resetTime: resetTime.toISOString(),
			endpoint: 'chat',
		});

		res.status(429).json({
			success: false,
			message: `Terlalu banyak pesan. Coba lagi dalam ${retryAfter}.`,
			retryAfter,
			retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
			resetTime: resetTime.toISOString(),
		});
	},
});
app.use('/api/chat', chatLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/recipes', recipeRoutes);
app.use('/api/fridge', fridgeRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/ingredients', ingredientRoutes);
app.use('/api/app', appRoutes);
app.use('/api/help', helpRoutes);
// Developer debug log. Deliberately not part of the release notes: it is a
// diagnostic aid for tracking down bugs, not a user-facing feature.
app.use('/api/devlog', devLogRoutes);

app.get('/api/health', (req, res) => {
	res.json({
		success: true,
		message: 'SmartCook API is running',
		timestamp: new Date(),
		environment: process.env.NODE_ENV || 'development',
		mongodb: isMongoConnected() ? 'connected' : 'disconnected',
	});
});

app.use((req, res) => {
	res
		.status(404)
		.json({ success: false, message: 'Endpoint tidak ditemukan.' });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
let httpServer = null;

const startServer = async () => {
	try {
		// Fail fast: a deployment without a usable token secret would accept
		// zero handshakes, which looks like "the update broke" to every user.
		try {
			assertConfigured();
		} catch (error) {
			console.error(`[app-tokens] ${error.message}`);
			process.exit(1);
		}

		const mongoConn = await connectMongoDB();
		if (!mongoConn) {
			console.error('Cannot start without MongoDB. Check MONGODB_URI in .env');
			process.exit(1);
		}

		initGemini();
		console.log('Gemini AI initialized successfully');

		httpServer = app.listen(PORT, '0.0.0.0', () => {
			console.log(`SmartCook API running on port ${PORT}`);
			console.log(`Health check: http://localhost:${PORT}/api/health`);
			console.log(
				'App access: handshake-gated tokens (access %dh, refresh %dh, key #%d, last rotated %s)',
				Math.round(accessTtlSeconds() / 3600),
				Math.round(refreshTtlSeconds() / 3600),
				keyIndex(),
				lastRotatedAt() || 'never',
			);
			console.log(
				'Token rotation is manual: run scripts/rotate-app-tokens.js (never automatic on restart)',
			);
			console.log(`Legacy x-api-key window: ${legacyDeadlineInfo()}`);
		});

		// Report live session counts once Mongo is up so an operator can see
		// the token estate without querying the database by hand.
		const { AppTokenService } = require('./src/modules/app-tokens/service');
		new AppTokenService()
			.stats()
			.then((s) => console.log(`[app-tokens] live=${s.live} expired=${s.expired} revoked=${s.revoked}`))
			.catch(() => {});
	} catch (error) {
		console.error('Failed to start server:', error.message);
		process.exit(1);
	}
};

// A rejected promise nobody awaited must not take the API down; a truly
// uncaught exception leaves the process in an unknown state, so log it and
// exit and let PM2 start a clean one.
process.on('unhandledRejection', (reason) => {
	console.error('[process] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
	console.error('[process] uncaughtException:', err && err.stack ? err.stack : err);
	process.exit(1);
});

// PM2 sends SIGTERM on restart/deploy. Stop accepting connections, let
// in-flight requests finish, then exit; force it after 10 s.
const shutdown = (signal) => {
	console.log(`[process] ${signal} received, shutting down`);
	const force = setTimeout(() => process.exit(0), 10000);
	force.unref();
	if (!httpServer) return process.exit(0);
	httpServer.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();
