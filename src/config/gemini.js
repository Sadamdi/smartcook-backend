const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI;
let model;
let currentKeyIndex = 0;

const API_KEY_STATE_PATH = path.join(__dirname, '..', '..', 'data', 'api-key-state.json');

/**
 * Cek apakah error adalah 429 (quota/rate limit)
 */
const is429Error = (error) => {
	if (!error || !error.message) return false;
	const msg = String(error.message);
	return msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('quota');
};

/**
 * Muat state API key dari JSON (key mana yang sedang dipakai / terakhir berhasil)
 */
const loadApiKeyState = () => {
	try {
		if (fs.existsSync(API_KEY_STATE_PATH)) {
			const raw = fs.readFileSync(API_KEY_STATE_PATH, 'utf8');
			const data = JSON.parse(raw);
			const idx = Number(data.currentKeyIndex);
			if (Number.isInteger(idx) && idx >= 0) return idx;
		}
	} catch (e) {
		// ignore
	}
	return 0;
};

/**
 * Simpan state API key ke JSON (untuk info key mana yang sedang dipakai)
 */
const saveApiKeyState = (keyIndex) => {
	try {
		const keys = getAllApiKeys();
		const label = keyIndex === 0 ? 'GOOGLE_API_KEY' : `GOOGLE_API_KEY${keyIndex}`;
		const dir = path.dirname(API_KEY_STATE_PATH);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			API_KEY_STATE_PATH,
			JSON.stringify(
				{
					currentKeyIndex: keyIndex,
					keyLabel: label,
					lastUpdated: new Date().toISOString(),
				},
				null,
				2,
			),
			'utf8',
		);
		console.log(`[Gemini] API key disimpan: ${label} (index ${keyIndex})`);
	} catch (e) {
		console.warn('[Gemini] Gagal menyimpan api-key-state.json:', e.message);
	}
};

const SYSTEM_PROMPT = `Kamu adalah SmartCook AI, asisten memasak pintar berbahasa Indonesia.
Tugasmu adalah membantu pengguna dengan:
- Merekomendasikan resep berdasarkan bahan yang tersedia di kulkas mereka
- Memberikan tips memasak dan teknik dapur
- Menyarankan substitusi bahan untuk alergi atau keterbatasan diet
- Membantu perencanaan menu harian (sarapan, makan siang, makan malam)
- Memberikan informasi nutrisi sederhana

Selalu pertimbangkan:
- Alergi makanan pengguna
- Riwayat penyakit pengguna (diabetes, kolesterol, asam urat, dll)
- Preferensi gaya masak pengguna
- Peralatan dapur yang dimiliki pengguna
- Bahan yang tersedia di kulkas pengguna

Jawab dengan ramah, singkat, dan praktis. Gunakan bahasa Indonesia yang mudah dipahami.
Jika memberikan resep, sertakan: nama masakan, bahan-bahan dengan takaran, dan langkah-langkah memasak.`;

/**
 * Mengambil semua GOOGLE_API_KEY yang tersedia dari environment variables
 */
const getAllApiKeys = () => {
	const keys = [];
	// Cek GOOGLE_API_KEY (tanpa angka)
	if (process.env.GOOGLE_API_KEY) {
		keys.push(process.env.GOOGLE_API_KEY);
	}
	// Cek GOOGLE_API_KEY1 sampai GOOGLE_API_KEY10
	for (let i = 1; i <= 10; i++) {
		const key = process.env[`GOOGLE_API_KEY${i}`];
		if (key && key.trim()) {
			keys.push(key.trim());
		}
	}
	// Fallback ke GEMINI_API_KEY jika ada
	if (keys.length === 0 && process.env.GEMINI_API_KEY) {
		keys.push(process.env.GEMINI_API_KEY);
	}
	return keys;
};

/**
 * Inisialisasi Gemini dengan API key tertentu
 */
const initGeminiWithKey = (apiKey) => {
	genAI = new GoogleGenerativeAI(apiKey);
	model = genAI.getGenerativeModel({
		model: 'gemini-2.5-flash-lite',
		systemInstruction: SYSTEM_PROMPT,
	});
	return model;
};

/**
 * Set model pakai API key di index tertentu (untuk retry dengan key lain)
 */
const setKeyByIndex = (keyIndex) => {
	const keys = getAllApiKeys();
	if (keys.length === 0) throw new Error('Tidak ada GOOGLE_API_KEY yang tersedia');
	const i = keyIndex >= keys.length ? 0 : keyIndex < 0 ? 0 : keyIndex;
	currentKeyIndex = i;
	return initGeminiWithKey(keys[i]);
};

/**
 * Inisialisasi Gemini: pakai key terakhir yang berhasil (dari JSON) atau key pertama
 */
const initGemini = () => {
	const keys = getAllApiKeys();
	if (keys.length === 0) {
		throw new Error(
			'Tidak ada GOOGLE_API_KEY yang tersedia di environment variables',
		);
	}
	const savedIndex = loadApiKeyState();
	const i = savedIndex >= keys.length ? 0 : savedIndex;
	currentKeyIndex = i;
	return initGeminiWithKey(keys[i]);
};

/**
 * Mengambil model Gemini, inisialisasi jika belum ada
 */
const getGeminiModel = () => {
	if (!model) {
		initGemini();
	}
	return model;
};

/**
 * Retry dengan mencoba semua API key yang tersedia
 */
const retryWithAllKeys = async (operation) => {
	const keys = getAllApiKeys();
	if (keys.length === 0) {
		throw new Error('Tidak ada GOOGLE_API_KEY yang tersedia');
	}

	let lastError;

	for (let i = 0; i < keys.length; i++) {
		try {
			// Inisialisasi ulang dengan key yang berbeda
			initGeminiWithKey(keys[i]);
			currentKeyIndex = i;

			// Coba operasi
			const result = await operation();
			return result;
		} catch (error) {
			lastError = error;
			console.error(
				`Error dengan GOOGLE_API_KEY${i === 0 ? '' : i} (index ${i}):`,
				error.message,
			);

			// Jika 429/limit dan masih ada key lain, coba key berikutnya
			const is429 = is429Error(error);
			if (i < keys.length - 1) {
				console.log(
					`${is429 ? '[429/limit]' : ''} Mencoba key berikutnya (${i + 2}/${keys.length})...`,
				);
				continue;
			}
		}
	}

	// Semua key gagal
	throw lastError || new Error('Semua API key gagal');
};

module.exports = {
	initGemini,
	getGeminiModel,
	SYSTEM_PROMPT,
	retryWithAllKeys,
	getAllApiKeys,
	getCurrentKeyIndex: () => currentKeyIndex,
	loadApiKeyState,
	saveApiKeyState,
	setKeyByIndex,
	is429Error,
};
