require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { connectMongoDB, isMongoConnected } = require('./src/config/db');
const { initGemini } = require('./src/config/gemini');
const { errorHandler } = require('./src/middleware/errorHandler');
const { validateApiKey } = require('./src/middleware/apiKey');
const { logEvent, buildRequestContext } = require('./src/utils/logger');

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/user');
const recipeRoutes = require('./src/routes/recipe');
const fridgeRoutes = require('./src/routes/fridge');
const favoriteRoutes = require('./src/routes/favorite');
const chatRoutes = require('./src/routes/chat');
const categoryRoutes = require('./src/routes/category');
const ingredientRoutes = require('./src/routes/ingredient');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/', validateApiKey);

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

const chatLimiter = rateLimit({
	windowMs: 1 * 60 * 1000,
	max: 20,
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

const startServer = async () => {
	try {
		const mongoConn = await connectMongoDB();
		if (!mongoConn) {
			console.error('Cannot start without MongoDB. Check MONGODB_URI in .env');
			process.exit(1);
		}

		initGemini();
		console.log('Gemini AI initialized successfully');

		app.listen(PORT, '0.0.0.0', () => {
			console.log(`SmartCook API running on port ${PORT}`);
			console.log(`Health check: http://localhost:${PORT}/api/health`);
			if (process.env.API_KEY) {
				console.log('API Key protection: ENABLED');
			} else {
				console.log(
					'API Key protection: DISABLED (set API_KEY in .env to enable)',
				);
			}
		});
	} catch (error) {
		console.error('Failed to start server:', error.message);
		process.exit(1);
	}
};

startServer();
