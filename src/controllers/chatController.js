const ChatHistory = require('../models/ChatHistory');
const FridgeItem = require('../models/FridgeItem');
const Favorite = require('../models/Favorite');
const Recipe = require('../models/Recipe');
const {
	getGeminiModel,
	retryWithAllKeys,
	getAllApiKeys,
	getCurrentKeyIndex,
	setKeyByIndex,
	saveApiKeyState,
	loadApiKeyState,
	is429Error,
} = require('../config/gemini');
const { logEvent, buildRequestContext } = require('../utils/logger');
const { searchBestImageUrl } = require('../services/imageSearchService');

const normalizeQuery = (q) =>
	String(q || '')
		.toLowerCase()
		.trim()
		.replace(/\s+/g, ' ');

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
	return s
		.split(' ')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(' ');
};

const extractLikelyJsonObject = (text) => {
	if (!text) return '';
	let s = String(text).trim();
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

const buildRecipePrompt = ({ query, user, fridgeNames }) => {
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
	const fridgeList =
		Array.isArray(fridgeNames) && fridgeNames.length > 0
			? fridgeNames.join(', ')
			: '';

	return `Buat 1 resep masakan untuk: "${query}".

Kamu harus menjawab dalam JSON murni (tanpa teks tambahan, tanpa markdown). Schema:
{
  "title": string,
  "description": string,
  "category": string,
  "meal_type": ["breakfast"|"lunch"|"dinner"],
  "tags": [string],
  "suitable_for": [string],
  "not_suitable_for": [string],
  "prep_time": number,
  "cook_time": number,
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
- Bahan di kulkas (nama yang sebaiknya dipakai jika relevan): ${fridgeList || '-'}
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

const ensureImagesForRecipes = async (recipes, { maxToFill = 3 } = {}) => {
	if (!Array.isArray(recipes) || recipes.length === 0) return recipes;
	let filled = 0;
	for (const r of recipes) {
		if (filled >= maxToFill) break;
		const hasUrl = !!(r && typeof r === 'object' && r.image_url);
		if (hasUrl) continue;

		const title = r?.title ? String(r.title) : '';
		if (!title) continue;

		const url = await searchBestImageUrl(title);
		if (!url) continue;

		const id = r?._id || r?.id;
		if (id) {
			await Recipe.findByIdAndUpdate(id, { image_url: url });
		}
		try {
			r.image_url = url;
		} catch (_) {}
		filled++;
	}
	return recipes;
};

const detectRecipeSearchIntent = (message) => {
	const msg = String(message || '').toLowerCase().trim();
	if (!msg) return { hasIntent: false, query: '' };

	const recipeKeywords = [
		'carikan resep',
		'cari resep',
		'resep',
		'masakan',
		'makanan',
		'resep untuk',
		'resep yang',
		'resep dengan',
		'resep tanpa',
		'resep ayam',
		'resep ikan',
		'resep daging',
		'resep sayur',
		'resep nasi',
		'resep mie',
		'resep roti',
		'resep kue',
		'resep cake',
		'resep kering',
		'resep basah',
	];

	let hasIntent = false;
	let query = '';

	for (const keyword of recipeKeywords) {
		if (msg.includes(keyword)) {
			hasIntent = true;
			const idx = msg.indexOf(keyword);
			const afterKeyword = msg.substring(idx + keyword.length).trim();
			if (afterKeyword) {
				const words = afterKeyword.split(/\s+/);
				const filtered = words.filter(
					(w) =>
						!['yang', 'yang', 'untuk', 'dengan', 'tanpa', 'ini', 'itu', 'saya', 'aku', 'kamu'].includes(w),
				);
				query = filtered.join(' ').trim();
			}
			if (!query && keyword.includes('resep')) {
				const beforeKeyword = msg.substring(0, idx).trim();
				if (beforeKeyword) {
					const words = beforeKeyword.split(/\s+/);
					const filtered = words.filter(
						(w) =>
							!['carikan', 'cari', 'tolong', 'bisa', 'mohon'].includes(w),
					);
					query = filtered.join(' ').trim();
				}
			}
			break;
		}
	}

	if (hasIntent && !query) {
		const words = msg.split(/\s+/);
		const filtered = words.filter(
			(w) =>
				!['carikan', 'cari', 'resep', 'tolong', 'bisa', 'mohon', 'yang', 'untuk', 'dengan', 'tanpa', 'ini', 'itu', 'saya', 'aku', 'kamu'].includes(w),
		);
		query = filtered.join(' ').trim();
	}

	return { hasIntent, query: query || msg };
};

const searchRecipesForBot = async (user, query) => {
	try {
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

		const userAllergiesRaw = Array.isArray(user?.allergies)
			? user.allergies
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

		let filteredExisting = filterByAllergy(existingAi);
		let filteredSeed = filterByAllergy(seedMatches);

		await ensureImagesForRecipes(filteredExisting, { maxToFill: 3 });
		await ensureImagesForRecipes(filteredSeed, { maxToFill: 3 });

		let results = [...filteredExisting, ...filteredSeed];

		if (results.length === 0) {
			const fridgeItems = await FridgeItem.find({ user_id: user._id });
			const fridgeNames = [
				...new Set(
					fridgeItems
						.map((i) => String(i.ingredient_name || '').trim())
						.filter((s) => s),
				),
			];

			const prompt = buildRecipePrompt({
				query,
				user,
				fridgeNames,
			});
			const result = await retryWithAllKeys(async () => {
				const model = getGeminiModel();
				return await model.generateContent(prompt);
			});
			const rawText = result?.response?.text?.() ?? '';
			const generatedJson = parseGeminiRecipeJson(rawText);

			const imageUrl = await searchBestImageUrl(
				generatedJson?.title || query,
			);
			const doc = toRecipeDocShape(generatedJson, {
				imageUrl,
				originQuery: query,
				originQueryNorm: norm,
				userId: user?._id,
			});

			const created = await Recipe.create(doc);
			results = [created];
		}

		return results.slice(0, 5);
	} catch (error) {
		console.error('[Chat] searchRecipesForBot error:', error);
		return [];
	}
};

const buildUserContext = async (user, fridgeItems) => {
	const parts = [];
	if (user.name) parts.push(`Nama pengguna: ${user.name}`);
	if (user.age_range) parts.push(`Usia: ${user.age_range}`);
	if (user.allergies && user.allergies.length > 0)
		parts.push(`Alergi makanan: ${user.allergies.join(', ')}`);
	if (user.medical_history && user.medical_history.length > 0)
		parts.push(`Riwayat penyakit: ${user.medical_history.join(', ')}`);
	if (user.cooking_styles && user.cooking_styles.length > 0)
		parts.push(`Gaya masak favorit: ${user.cooking_styles.join(', ')}`);
	if (user.equipment && user.equipment.length > 0)
		parts.push(`Peralatan dapur: ${user.equipment.join(', ')}`);
	if (fridgeItems.length > 0) {
		parts.push(
			`Bahan di kulkas: ${fridgeItems.map((i) => `${i.ingredient_name} (${i.quantity} ${i.unit})`).join(', ')}`,
		);
	}

	try {
		const favorites = await Favorite.find({ user_id: user._id })
			.populate('recipe_id', 'title')
			.limit(10)
			.sort({ created_at: -1 });
		if (favorites.length > 0) {
			const favoriteTitles = favorites
				.map((f) => f.recipe_id?.title)
				.filter(Boolean);
			if (favoriteTitles.length > 0) {
				parts.push(`Resep favorit: ${favoriteTitles.join(', ')}`);
			}
		}

		const userRecipes = await Recipe.find({ created_by: user._id })
			.select('title')
			.limit(10)
			.sort({ created_at: -1 });
		if (userRecipes.length > 0) {
			const userRecipeTitles = userRecipes.map((r) => r.title).filter(Boolean);
			if (userRecipeTitles.length > 0) {
				parts.push(`Resep yang pernah kamu buat: ${userRecipeTitles.join(', ')}`);
			}
		}
	} catch (error) {
		console.error('[Chat] buildUserContext error fetching recipes:', error);
	}

	if (parts.length === 0) return '';
	return `\n\nKonteks pengguna:\n${parts.join('\n')}`;
};

const sendMessage = async (req, res, next) => {
	try {
		const { message } = req.body;
		if (!message || !message.trim()) {
			const ctx = buildRequestContext(req);
			logEvent('chat_send', {
				...ctx,
				success: false,
				statusCode: 400,
				reason: 'empty_message',
			});
			return res
				.status(400)
				.json({ success: false, message: 'Pesan tidak boleh kosong.' });
		}

		const fridgeItems = await FridgeItem.find({ user_id: req.user._id });
		let chatDoc = await ChatHistory.findOne({ user_id: req.user._id });
		let history = [];
		if (chatDoc && chatDoc.messages.length > 0) {
			const recent = chatDoc.messages.slice(-20);
			history = recent.map((msg) => ({
				role: msg.role,
				parts: [{ text: msg.content }],
			}));
		}

		const userContext = buildUserContext(req.user, fridgeItems);
		const fullMessage = userContext ? `${message}\n${userContext}` : message;

		const result = await retryWithAllKeys(async () => {
			const model = getGeminiModel();
			const chat = model.startChat({ history });
			return await chat.sendMessage(fullMessage);
		});

		saveApiKeyState(getCurrentKeyIndex());
		const reply = result.response.text();

		const newUserMsg = {
			role: 'user',
			content: message,
			timestamp: new Date(),
		};
		const newModelMsg = {
			role: 'model',
			content: reply,
			timestamp: new Date(),
		};
		const allMessages = chatDoc
			? [...chatDoc.messages, newUserMsg, newModelMsg]
			: [newUserMsg, newModelMsg];

		await ChatHistory.findOneAndUpdate(
			{ user_id: req.user._id },
			{ messages: allMessages, updated_at: new Date() },
			{ upsert: true },
		);

		const ctx = buildRequestContext(req);
		logEvent('chat_send', {
			...ctx,
			success: true,
			statusCode: 200,
			messageLength: message.length,
			replyLength: reply.length,
		});

		res.json({
			success: true,
			data: { reply, timestamp: new Date() },
		});
	} catch (error) {
		next(error);
	}
};

const getHistory = async (req, res, next) => {
	try {
		const chatDoc = await ChatHistory.findOne({ user_id: req.user._id });
		if (!chatDoc) {
			const ctx = buildRequestContext(req);
			logEvent('chat_history', {
				...ctx,
				success: true,
				statusCode: 200,
				messagesCount: 0,
			});
			return res.json({ success: true, data: { messages: [] } });
		}
		const ctx = buildRequestContext(req);
		logEvent('chat_history', {
			...ctx,
			success: true,
			statusCode: 200,
			messagesCount: chatDoc.messages.length,
		});
		res.json({
			success: true,
			data: {
				messages: chatDoc.messages,
				created_at: chatDoc.created_at,
				updated_at: chatDoc.updated_at,
			},
		});
	} catch (error) {
		next(error);
	}
};

const sendMessageStream = async (req, res, next) => {
	try {
		const { message } = req.body;
		const start = Date.now();
		if (!message || !message.trim()) {
			const ctx = buildRequestContext(req);
			logEvent('chat_send_stream', {
				...ctx,
				success: false,
				statusCode: 400,
				reason: 'empty_message',
			});
			return res
				.status(400)
				.json({ success: false, message: 'Pesan tidak boleh kosong.' });
		}

		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Connection', 'keep-alive');
		res.setHeader('X-Accel-Buffering', 'no');
		res.flushHeaders?.();

		res.write(`data: ${JSON.stringify({ status: 'connected' })}\n\n`);
		if (typeof res.flush === 'function') res.flush();

		const [fridgeItems, chatDoc] = await Promise.all([
			FridgeItem.find({ user_id: req.user._id }),
			ChatHistory.findOne({ user_id: req.user._id }),
		]);

		let history = [];
		if (chatDoc && chatDoc.messages.length > 0) {
			const recent = chatDoc.messages.slice(-20);
			history = recent.map((msg) => ({
				role: msg.role,
				parts: [{ text: msg.content }],
			}));
		}

		const intentResult = detectRecipeSearchIntent(message);
		let recipeResults = [];
		if (intentResult.hasIntent && intentResult.query) {
			recipeResults = await searchRecipesForBot(req.user, intentResult.query);
			if (recipeResults.length > 0) {
				const recipesData = recipeResults.map((r) => ({
					_id: r._id?.toString(),
					title: r.title,
					image_url: r.image_url,
					nutrition_info: r.nutrition_info,
					prep_time: r.prep_time,
					cook_time: r.cook_time,
				}));
				res.write(`data: ${JSON.stringify({ type: 'recipe_embed', recipes: recipesData })}\n\n`);
				if (typeof res.flush === 'function') res.flush();

				const ctx = buildRequestContext(req);
				logEvent('chat_recipe_search', {
					...ctx,
					success: true,
					statusCode: 200,
					query: intentResult.query,
					resultsCount: recipeResults.length,
					generated: recipeResults.some((r) => r.source === 'ai' && r.created_by?.toString() === req.user._id.toString()),
				});
			}
		}

		const userContext = await buildUserContext(req.user, fridgeItems);
		const fullMessage = userContext ? `${message}\n${userContext}` : message;

		const keys = getAllApiKeys();
		if (keys.length === 0) throw new Error('Tidak ada GOOGLE_API_KEY yang tersedia');

		let finalReply = '';
		const startIndex = loadApiKeyState();
		for (let i = 0; i < keys.length; i++) {
			const keyIndex = (startIndex + i) % keys.length;
			try {
				setKeyByIndex(keyIndex);
				const model = getGeminiModel();
				const chat = model.startChat({ history });
				const result = await chat.sendMessageStream(fullMessage);

				for await (const chunk of result.stream) {
					const chunkText = chunk.text?.() ?? '';
					if (chunkText) {
						res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
						if (typeof res.flush === 'function') res.flush();
					}
				}

				const finalResponse = await result.response;
				finalReply = finalResponse?.text?.() ?? '';
				saveApiKeyState(keyIndex);
				break;
			} catch (error) {
				console.error(
					`Error dengan GOOGLE_API_KEY${keyIndex === 0 ? '' : keyIndex} (index ${keyIndex}):`,
					error.message,
				);
				if (is429Error(error) && i < keys.length - 1) {
					const next = (startIndex + i + 1) % keys.length;
					console.log(`[429/limit] Mencoba key berikutnya: index ${next} (${i + 2}/${keys.length})...`);
					continue;
				}
				throw error;
			}
		}

		const newUserMsg = {
			role: 'user',
			content: message,
			timestamp: new Date(),
		};
		const newModelMsg = {
			role: 'model',
			content: finalReply,
			timestamp: new Date(),
		};
		const allMessages = chatDoc
			? [...chatDoc.messages, newUserMsg, newModelMsg]
			: [newUserMsg, newModelMsg];

		await ChatHistory.findOneAndUpdate(
			{ user_id: req.user._id },
			{ messages: allMessages, updated_at: new Date() },
			{ upsert: true },
		);

		res.write(`data: ${JSON.stringify({ done: true, fullReply })}\n\n`);
		if (typeof res.flush === 'function') res.flush();
		res.end();

		const ctx = buildRequestContext(req);
		const durationMs = Date.now() - start;
		logEvent('chat_send_stream', {
			...ctx,
			success: true,
			statusCode: 200,
			messageLength: message.length,
			replyLength: finalReply.length,
			durationMs,
		});
	} catch (error) {
		if (!res.headersSent) {
			res.setHeader('Content-Type', 'text/event-stream');
			res.flushHeaders?.();
		}
		try {
			res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
			if (typeof res.flush === 'function') res.flush();
			res.end();
		} catch (e) {
			next(error);
		}
		const ctx = buildRequestContext(req);
		logEvent('chat_send_stream', {
			...ctx,
			success: false,
			statusCode: 500,
			reason: error.message,
		});
	}
};

const deleteHistory = async (req, res, next) => {
	try {
		await ChatHistory.findOneAndDelete({ user_id: req.user._id });
		const ctx = buildRequestContext(req);
		logEvent('chat_history_delete', {
			...ctx,
			success: true,
			statusCode: 200,
		});
		res.json({
			success: true,
			message: 'Riwayat chat berhasil dihapus.',
		});
	} catch (error) {
		next(error);
	}
};

module.exports = { sendMessage, sendMessageStream, getHistory, deleteHistory };
