const Recipe = require('../models/Recipe');
const FridgeItem = require('../models/FridgeItem');
const User = require('../models/User');
const { getGeminiModel, retryWithAllKeys } = require('../config/gemini');
const { searchBestImageUrl } = require('../services/imageSearchService');

const normalizeQuery = (q) =>
	String(q || '')
		.toLowerCase()
		.trim()
		.replace(/\s+/g, ' ');

const ensureImagesForRecipes = async (recipes, { maxToFill = 3 } = {}) => {
	if (!Array.isArray(recipes) || recipes.length === 0) return recipes;
	let filled = 0;
	for (const r of recipes) {
		if (filled >= maxToFill) break;
		const hasUrl = !!(r && typeof r === 'object' && r.image_url);
		if (hasUrl) continue;

		const title = r?.title ? String(r.title) : '';
		if (!title) continue;

		console.log(`[Recipe] Cari gambar untuk "${title}"`);
		const url = await searchBestImageUrl(title);
		if (!url) continue;

		const id = r?._id || r?.id;
		if (id) {
			await Recipe.findByIdAndUpdate(id, { image_url: url });
			console.log(`[Recipe] Simpan image_url untuk recipeId=${id}: ${url}`);
		}
		// update response object/doc too
		try {
			r.image_url = url;
		} catch (_) {}
		filled++;
	}
	return recipes;
};

const normalizeAllergyLabel = (label) => {
	const s = String(label || '').trim();
	if (!s) return '';
	const lower = s.toLowerCase();
	if (lower.includes('seafood') || lower.includes('seafod')) return 'Seafod';
	if (lower.includes('fish') || lower.includes('ikan')) return 'Ikan';
	if (lower.includes('peanut') || lower.includes('kacang')) return 'Kacang';
	if (lower.includes('soy') || lower.includes('kedelai')) return 'Kedelai';
	if (lower.includes('wheat') || lower.includes('gandum')) return 'Gandum';
	if (
		lower.includes('milk') ||
		lower.includes('dairy') ||
		lower.includes('susu sapi')
	)
		return 'Susu Sapi';
	if (lower.includes('susu')) return 'Susu';

	// Default: title case sederhana
	return s
		.split(' ')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(' ');
};

const extractLikelyJsonObject = (text) => {
	if (!text) return '';
	let s = String(text).trim();
	// Strip markdown fences if any
	s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
	const first = s.indexOf('{');
	const last = s.lastIndexOf('}');
	if (first >= 0 && last > first) return s.slice(first, last + 1);
	return s;
};

const parseGeminiRecipeJson = (rawText) => {
	const candidate = extractLikelyJsonObject(rawText);
	const parsed = JSON.parse(candidate);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Format JSON resep tidak valid');
	}
	return parsed;
};

const buildRecipePrompt = ({ query, user }) => {
	const allergies =
		Array.isArray(user?.allergies) && user.allergies.length > 0
			? user.allergies.join(', ')
			: '';
	const medical =
		Array.isArray(user?.medical_history) && user.medical_history.length > 0
			? user.medical_history.join(', ')
			: '';
	const styles =
		Array.isArray(user?.cooking_styles) && user.cooking_styles.length > 0
			? user.cooking_styles.join(', ')
			: '';

	return `Buat 1 resep masakan untuk: "${query}".

Kamu harus menjawab dalam JSON murni (tanpa teks tambahan, tanpa markdown). Schema:
{
  "title": string,
  "description": string,
  "category": string,
  "meal_type": ["breakfast"|"lunch"|"dinner"],
  "tags": [string],
  "suitable_for": [string],      // daftar alergi yang aman dikonsumsi untuk resep ini
  "not_suitable_for": [string],  // daftar alergi yang tidak aman (resep ini mengandung pemicu)
  "prep_time": number,   // menit
  "cook_time": number,   // menit
  "servings": number,
  "nutrition_info": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "ingredients": [ { "name": string, "quantity": string, "unit": string } ],
  "steps": [ { "instruction": string } ]
}

Aturan:
- Pakai bahasa Indonesia.
- Waktu & kalori harus masuk akal.
- Jangan memasukkan bahan yang termasuk alergi/riwayat penyakit jika disebut.
- Buat langkah jelas 6-12 langkah.
-
// Tentang alergi:
- Gunakan hanya label alergi dari daftar berikut jika relevan:
- ["Kacang", "Telur", "Susu", "Ikan", "Seafod", "Kedelai", "Gandum", "Susu Sapi"]
- Jika ragu apakah aman untuk suatu alergi, lebih baik masukkan ke not_suitable_for.
- Selalu isi "suitable_for" dan "not_suitable_for" sebagai array (boleh kosong jika tidak relevan).

Konteks user (opsional):
- Alergi: ${allergies || '-'}
- Riwayat penyakit: ${medical || '-'}
- Preferensi gaya masak: ${styles || '-'}
`;
};

const toRecipeDocShape = (generated, { imageUrl, originQuery, originQueryNorm, userId }) => {
	const title = String(generated?.title || originQuery || 'Resep').trim();
	const description = String(generated?.description || '').trim();
	const category = String(generated?.category || '').trim();
	const mealType = Array.isArray(generated?.meal_type) ? generated.meal_type : [];
	const tags = Array.isArray(generated?.tags) ? generated.tags : [];
	const prepTime = Number.isFinite(Number(generated?.prep_time))
		? Number(generated.prep_time)
		: 0;
	const cookTime = Number.isFinite(Number(generated?.cook_time))
		? Number(generated.cook_time)
		: 0;
	const servings = Number.isFinite(Number(generated?.servings))
		? Number(generated.servings)
		: 1;

	const nutrition =
		generated?.nutrition_info && typeof generated.nutrition_info === 'object'
		? generated.nutrition_info
		: {};

	const ingredientsRaw = Array.isArray(generated?.ingredients) ? generated.ingredients : [];
	const ingredients = ingredientsRaw
		.map((it) => ({
			name: String(it?.name || '').trim(),
			quantity: String(it?.quantity || '').trim(),
			unit: String(it?.unit || '').trim(),
		}))
		.filter((it) => it.name);

	const stepsRaw = Array.isArray(generated?.steps) ? generated.steps : [];
	const steps = stepsRaw
		.map((st, idx) => ({
			order: idx + 1,
			instruction: String(st?.instruction || st?.text || st || '').trim(),
		}))
		.filter((st) => st.instruction);

	const suitableRaw = Array.isArray(generated?.suitable_for)
		? generated.suitable_for
		: [];
	const notSuitableRaw = Array.isArray(generated?.not_suitable_for)
		? generated.not_suitable_for
		: [];

	const suitableSet = new Set(
		suitableRaw
			.map((it) => normalizeAllergyLabel(it))
			.filter((it) => !!it),
	);
	const notSuitableSet = new Set(
		notSuitableRaw
			.map((it) => normalizeAllergyLabel(it))
			.filter((it) => !!it),
	);

	return {
		source: 'ai',
		created_by: userId || null,
		origin_query: originQuery || '',
		origin_query_norm: originQueryNorm || '',
		title,
		description,
		image_url: imageUrl || '',
		category,
		meal_type: mealType,
		tags,
		prep_time: prepTime,
		cook_time: cookTime,
		servings,
		nutrition_info: {
			calories: Number(nutrition?.calories) || 0,
			protein: Number(nutrition?.protein) || 0,
			carbs: Number(nutrition?.carbs) || 0,
			fat: Number(nutrition?.fat) || 0,
		},
		ingredients,
		steps,
		suitable_for: Array.from(suitableSet),
		not_suitable_for: Array.from(notSuitableSet),
	};
};

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

		// Best-effort: isi sebagian gambar kalau masih kosong (dibatasi agar tidak boros API)
		await ensureImagesForRecipes(recipes, { maxToFill: 2 });

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
		let recipe = await Recipe.findById(req.params.id);
		if (!recipe) {
			return res
				.status(404)
				.json({ success: false, message: 'Resep tidak ditemukan.' });
		}
		// Auto-fill gambar jika masih kosong (best-effort, dengan limit & fallback dari imageSearchService)
		if (!recipe.image_url) {
			const imageUrl = await searchBestImageUrl(recipe.title);
			if (imageUrl) {
				recipe.image_url = imageUrl;
				await recipe.save();
			}
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

const aiSearchRecipes = async (req, res, next) => {
	try {
		const { q } = req.query;
		if (!q || !String(q).trim()) {
			return res
				.status(400)
				.json({ success: false, message: 'Query pencarian wajib diisi.' });
		}

		const query = String(q).trim();
		const norm = normalizeQuery(query);

		// 1) Existing pool (AI) untuk query sama (global)
		const existingAi = await Recipe.find({
			source: 'ai',
			origin_query_norm: norm,
		})
			.sort({ created_at: -1 })
			.limit(10);

		// 2) Seed matches via text search (opsional, agar user lihat resep curated juga)
		const seedMatches = await Recipe.find({
			source: { $ne: 'ai' },
			$text: { $search: query },
		})
			.sort({ score: { $meta: 'textScore' } })
			.limit(5);

		// 3) Generate 1 resep AI baru setiap kali search
		const prompt = buildRecipePrompt({ query, user: req.user });
		const result = await retryWithAllKeys(async () => {
			const model = getGeminiModel();
			return await model.generateContent(prompt);
		});
		const rawText = result?.response?.text?.() ?? '';
		const generatedJson = parseGeminiRecipeJson(rawText);

		// cari gambar berdasarkan title (lebih akurat daripada query)
		const imageUrl = await searchBestImageUrl(
			generatedJson?.title || query,
		);
		const doc = toRecipeDocShape(generatedJson, {
			imageUrl,
			originQuery: query,
			originQueryNorm: norm,
			userId: req.user?._id,
		});

		const created = await Recipe.create(doc);

		// Best-effort: isi gambar untuk hasil existing juga (dibatasi).
		// Tidak masalah sedikit lebih lambat di endpoint ini karena dipakai khusus pencarian AI.
		await ensureImagesForRecipes(existingAi, { maxToFill: 2 });
		await ensureImagesForRecipes(seedMatches, { maxToFill: 2 });

		// Gabungkan hasil: existing pool + seed + generated (generated terakhir biar “resep baru” terlihat)
		let results = [...existingAi, ...seedMatches, created];

		// Filter berdasarkan alergi user jika ada metadata not_suitable_for
		const userAllergiesRaw = Array.isArray(req.user?.allergies)
			? req.user.allergies
			: [];
		const userAllergies = userAllergiesRaw
			.map((a) => normalizeAllergyLabel(a))
			.filter((a) => !!a);
		if (userAllergies.length > 0) {
			const allergySet = new Set(userAllergies);
			results = results.filter((r) => {
				const raw = Array.isArray(r?.not_suitable_for)
					? r.not_suitable_for
					: [];
				const normalized = raw
					.map((a) => normalizeAllergyLabel(a))
					.filter((a) => !!a);
				return !normalized.some((a) => allergySet.has(a));
			});
		}

		res.json({
			success: true,
			data: {
				query,
				existing: existingAi,
				seed_matches: seedMatches,
					generated: created,
				results,
			},
		});
	} catch (error) {
		next(error);
	}
};

// Existing-only search untuk autocomplete/background refresh (tanpa generate AI)
const queryRecipes = async (req, res, next) => {
	try {
		const { q } = req.query;
		if (!q || !String(q).trim()) {
			return res
				.status(400)
				.json({ success: false, message: 'Query pencarian wajib diisi.' });
		}

		const query = String(q).trim();
		const norm = normalizeQuery(query);

		const [existingAi, seedMatches] = await Promise.all([
			Recipe.find({ source: 'ai', origin_query_norm: norm })
				.sort({ created_at: -1 })
				.limit(20),
			Recipe.find({
				source: { $ne: 'ai' },
				$text: { $search: query },
			})
				.sort({ score: { $meta: 'textScore' } })
				.limit(10),
		]);

		const userAllergiesRaw = Array.isArray(req.user?.allergies)
			? req.user.allergies
			: [];
		const userAllergies = userAllergiesRaw
			.map((a) => normalizeAllergyLabel(a))
			.filter((a) => !!a);
		const allergySet =
			userAllergies.length > 0 ? new Set(userAllergies) : null;

		const filterByAllergy = (list) => {
			if (!allergySet) return list;
			return list.filter((r) => {
				const raw = Array.isArray(r?.not_suitable_for)
					? r.not_suitable_for
					: [];
				const normalized = raw
					.map((a) => normalizeAllergyLabel(a))
					.filter((a) => !!a);
				return !normalized.some((a) => allergySet.has(a));
			});
		};

		const filteredExisting = filterByAllergy(existingAi);
		const filteredSeed = filterByAllergy(seedMatches);

		await ensureImagesForRecipes(filteredExisting, { maxToFill: 3 });
		await ensureImagesForRecipes(filteredSeed, { maxToFill: 3 });

		res.json({
			success: true,
			data: {
				query,
					existing: filteredExisting,
					seed_matches: filteredSeed,
					results: [...filteredExisting, ...filteredSeed],
			},
		});
	} catch (error) {
		next(error);
	}
};

const getRecommendations = async (req, res, next) => {
	try {
		const { limit = 5 } = req.query;
		const size = parseInt(limit);
		const userAllergiesRaw = Array.isArray(req.user?.allergies)
			? req.user.allergies
			: [];
		const userAllergies = userAllergiesRaw
			.map((a) => normalizeAllergyLabel(a))
			.filter((a) => !!a);

		const matchSafeForUser =
			userAllergies.length > 0
				? { not_suitable_for: { $nin: userAllergies } }
				: {};

		// Prioritas: random dari resep yang pernah dicari (source: ai) dan aman untuk alergi user
		let recipes = await Recipe.aggregate([
			{ $match: { source: 'ai', ...matchSafeForUser } },
			{ $sample: { size } },
		]);

		// Fallback 1: kalau belum cukup, ambil dari semua resep yang aman untuk alergi user
		if (!recipes || recipes.length === 0) {
			recipes = await Recipe.aggregate([
				{ $match: matchSafeForUser },
				{ $sample: { size } },
			]);
		}

		// Fallback 2: jika masih kosong, ambil random dari semua resep (tanpa filter)
		if (!recipes || recipes.length === 0) {
			recipes = await Recipe.aggregate([{ $sample: { size } }]);
		}

		// Best-effort: isi sebagian gambar. Tidak perlu ditunggu untuk respon ke home.
		ensureImagesForRecipes(recipes, {
			maxToFill: Math.min(5, size),
		}).catch((err) =>
			console.warn(
				`[Recipe] ensureImagesForRecipes error di getRecommendations: ${err.message}`,
			),
		);

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

		// Best-effort: isi sebagian gambar per meal type. Tidak perlu ditunggu untuk respon ke home.
		ensureImagesForRecipes(recipes, { maxToFill: 3 }).catch((err) =>
			console.warn(
				`[Recipe] ensureImagesForRecipes error di getByMealType: ${err.message}`,
			),
		);

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
	aiSearchRecipes,
	queryRecipes,
	getRecommendations,
	getByMealType,
};
