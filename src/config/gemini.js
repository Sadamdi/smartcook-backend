const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI;
let model;
let currentKeyIndex = 0;

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
		model: 'gemini-2.5-flash',
		systemInstruction: SYSTEM_PROMPT,
	});
	return model;
};

/**
 * Inisialisasi Gemini dengan API key pertama yang tersedia
 */
const initGemini = () => {
	const keys = getAllApiKeys();
	if (keys.length === 0) {
		throw new Error('Tidak ada GOOGLE_API_KEY yang tersedia di environment variables');
	}
	currentKeyIndex = 0;
	return initGeminiWithKey(keys[0]);
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
			console.error(`Error dengan GOOGLE_API_KEY${i === 0 ? '' : i} (index ${i}):`, error.message);
			
			// Jika ini bukan key terakhir, coba key berikutnya
			if (i < keys.length - 1) {
				console.log(`Mencoba key berikutnya (${i + 2}/${keys.length})...`);
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
	getAllApiKeys
};
