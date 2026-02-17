const Recipe = require('../models/Recipe');
const FridgeItem = require('../models/FridgeItem');
const User = require('../models/User');

const getRecipes = async (req, res, next) => {
	try {
		const { page = 1, limit = 10, category, tags } = req.query;
		const offset = (parseInt(page) - 1) * parseInt(limit);
		const query = {};
		if (category) query.category = category;
		if (tags) query.tags = { $in: tags.split(',') };

		const [recipes, total] = await Promise.all([
			Recipe.find(query)
				.skip(offset)
				.limit(parseInt(limit))
				.sort({ created_at: -1 }),
			Recipe.countDocuments(query),
		]);

		res.json({
			success: true,
			data: recipes,
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

const getRecipeById = async (req, res, next) => {
	try {
		const recipe = await Recipe.findById(req.params.id);
		if (!recipe) {
			return res
				.status(404)
				.json({ success: false, message: 'Resep tidak ditemukan.' });
		}
		res.json({ success: true, data: recipe });
	} catch (error) {
		next(error);
	}
};

const searchRecipes = async (req, res, next) => {
	try {
		const { q, page = 1, limit = 10 } = req.query;
		if (!q) {
			return res
				.status(400)
				.json({ success: false, message: 'Query pencarian wajib diisi.' });
		}
		const offset = (parseInt(page) - 1) * parseInt(limit);
		const recipes = await Recipe.find({ $text: { $search: q } })
			.skip(offset)
			.limit(parseInt(limit))
			.sort({ score: { $meta: 'textScore' } });
		const total = await Recipe.countDocuments({ $text: { $search: q } });

		res.json({
			success: true,
			data: recipes,
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

const getRecommendations = async (req, res, next) => {
	try {
		const { limit = 5 } = req.query;
		const mongoFridge = await FridgeItem.find({ user_id: req.user._id });
		let ingredientNames = mongoFridge.map((item) =>
			item.ingredient_name.toLowerCase(),
		);
		const user = await User.findById(req.user._id);

		let query = {};
		if (ingredientNames.length > 0) {
			query['ingredients.name'] = {
				$in: ingredientNames.map((name) => new RegExp(name, 'i')),
			};
		}
		if (user.allergies && user.allergies.length > 0) {
			query.not_suitable_for = { $nin: user.allergies };
		}
		if (user.cooking_styles && user.cooking_styles.length > 0) {
			query.tags = { $in: user.cooking_styles };
		}

		let recipes = await Recipe.find(query).limit(parseInt(limit));
		if (recipes.length === 0) {
			recipes = await Recipe.aggregate([
				{ $sample: { size: parseInt(limit) } },
			]);
		}

		res.json({ success: true, data: recipes });
	} catch (error) {
		next(error);
	}
};

const getByMealType = async (req, res, next) => {
	try {
		const { type } = req.params;
		const { page = 1, limit = 10 } = req.query;
		const validTypes = ['breakfast', 'lunch', 'dinner'];
		if (!validTypes.includes(type)) {
			return res.status(400).json({
				success: false,
				message: 'Tipe meal harus breakfast, lunch, atau dinner.',
			});
		}
		const offset = (parseInt(page) - 1) * parseInt(limit);
		const [recipes, total] = await Promise.all([
			Recipe.find({ meal_type: type })
				.skip(offset)
				.limit(parseInt(limit))
				.sort({ created_at: -1 }),
			Recipe.countDocuments({ meal_type: type }),
		]);

		res.json({
			success: true,
			data: recipes,
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

module.exports = {
	getRecipes,
	getRecipeById,
	searchRecipes,
	getRecommendations,
	getByMealType,
};
