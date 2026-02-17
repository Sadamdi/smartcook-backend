const Favorite = require('../models/Favorite');
const Recipe = require('../models/Recipe');
const { logEvent, buildRequestContext } = require('../utils/logger');

const getFavorites = async (req, res, next) => {
	try {
		const { page = 1, limit = 10 } = req.query;
		const offset = (parseInt(page) - 1) * parseInt(limit);
		const [favorites, total] = await Promise.all([
			Favorite.find({ user_id: req.user._id })
				.populate('recipe_id')
				.sort({ created_at: -1 })
				.skip(offset)
				.limit(parseInt(limit)),
			Favorite.countDocuments({ user_id: req.user._id }),
		]);
		const ctx = buildRequestContext(req);
		logEvent('favorite_list', {
			...ctx,
			success: true,
			statusCode: 200,
			count: favorites.length,
		});
		res.json({
			success: true,
			data: favorites.map((fav) => ({
				_id: fav._id,
				recipe_mongo_id: fav.recipe_id?._id,
				recipe: fav.recipe_id,
				created_at: fav.created_at,
			})),
			pagination: {
				page: parseInt(page),
				limit: parseInt(limit),
				total,
				pages: Math.ceil(total / parseInt(limit)),
			},
		});
	} catch (error) {
		next(error);
	}
};

const addFavorite = async (req, res, next) => {
	try {
		const { recipeId } = req.params;
		const recipe = await Recipe.findById(recipeId);
		if (!recipe) {
			const ctx = buildRequestContext(req);
			logEvent('favorite_add', {
				...ctx,
				success: false,
				statusCode: 404,
				reason: 'recipe_not_found',
				recipeId,
			});
			return res
				.status(404)
				.json({ success: false, message: 'Resep tidak ditemukan.' });
		}
		const existing = await Favorite.findOne({
			user_id: req.user._id,
			recipe_id: recipeId,
		});
		if (existing) {
			const ctx = buildRequestContext(req);
			logEvent('favorite_add', {
				...ctx,
				success: false,
				statusCode: 400,
				reason: 'already_favorited',
				recipeId,
			});
			return res
				.status(400)
				.json({ success: false, message: 'Resep sudah ada di favorit.' });
		}
		const fav = await Favorite.create({
			user_id: req.user._id,
			recipe_id: recipeId,
		});
		const ctx = buildRequestContext(req);
		logEvent('favorite_add', {
			...ctx,
			success: true,
			statusCode: 201,
			recipeId,
			favoriteId: fav._id.toString(),
		});
		res.status(201).json({
			success: true,
			message: 'Resep ditambahkan ke favorit.',
			data: { _id: fav._id, recipe_id: recipeId, created_at: fav.created_at },
		});
	} catch (error) {
		next(error);
	}
};

const removeFavorite = async (req, res, next) => {
	try {
		const { recipeId } = req.params;
		const deleted = await Favorite.findOneAndDelete({
			user_id: req.user._id,
			recipe_id: recipeId,
		});
		if (!deleted) {
			const ctx = buildRequestContext(req);
			logEvent('favorite_remove', {
				...ctx,
				success: false,
				statusCode: 404,
				reason: 'not_in_favorites',
				recipeId,
			});
			return res
				.status(404)
				.json({ success: false, message: 'Resep tidak ada di favorit.' });
		}
		const ctx = buildRequestContext(req);
		logEvent('favorite_remove', {
			...ctx,
			success: true,
			statusCode: 200,
			recipeId,
		});
		res.json({
			success: true,
			message: 'Resep dihapus dari favorit.',
		});
	} catch (error) {
		next(error);
	}
};

module.exports = { getFavorites, addFavorite, removeFavorite };
