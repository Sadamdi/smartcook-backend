const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', '..', 'data');

// File terpisah per jenis service, sesuai requirement
const GOOGLE_IMAGE_STATE_FILE = path.join(STATE_DIR, 'google-image-state.json');
const FALLBACK_IMAGE_STATE_FILE = path.join(
	STATE_DIR,
	'fallback-image-state.json',
);

const ensureDir = () => {
	if (!fs.existsSync(STATE_DIR)) {
		fs.mkdirSync(STATE_DIR, { recursive: true });
	}
};

const readJsonFile = async (filePath, defaultValue = {}) => {
	try {
		ensureDir();
		if (!fs.existsSync(filePath)) {
			return defaultValue;
		}
		const raw = await fs.promises.readFile(filePath, 'utf8');
		if (!raw.trim()) return defaultValue;
		return JSON.parse(raw);
	} catch (err) {
		console.warn(
			`[JsonStateStore] Gagal baca "${filePath}": ${err.message}. Pakai default.`,
		);
		return defaultValue;
	}
};

const writeJsonFile = async (filePath, data) => {
	try {
		ensureDir();
		const json = JSON.stringify(data ?? {}, null, 2);
		await fs.promises.writeFile(filePath, json, 'utf8');
	} catch (err) {
		console.warn(
			`[JsonStateStore] Gagal tulis "${filePath}": ${err.message}.`,
		);
	}
};

const getTodayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Membaca state harian dari file dengan auto-reset jika pindah hari.
 * Struktur minimal:
 * {
 *   "date": "YYYY-MM-DD",
 *   "keys": {},
 *   "services": {}
 * }
 */
const loadDailyState = async (filePath) => {
	const today = getTodayStr();
	const current = await readJsonFile(filePath, {});
	if (!current || typeof current !== 'object') {
		return { date: today, keys: {}, services: {} };
	}
	if (current.date !== today) {
		return { date: today, keys: {}, services: {} };
	}
	return {
		date: current.date || today,
		keys: current.keys || {},
		services: current.services || {},
	};
};

const saveDailyState = async (filePath, state) => {
	const today = getTodayStr();
	const normalized = {
		date: state?.date || today,
		keys: state?.keys || {},
		services: state?.services || {},
	};
	await writeJsonFile(filePath, normalized);
};

// ---------- Key-level helpers (per API key) ----------

const isKeyLimitedToday = async (filePath, keyLabel) => {
	const state = await loadDailyState(filePath);
	const meta = state.keys?.[keyLabel];
	return !!(meta && meta.limited === true);
};

const markKeyLimitedToday = async (filePath, keyLabel, reason) => {
	const today = getTodayStr();
	const state = await loadDailyState(filePath);
	if (!state.keys) state.keys = {};
	state.keys[keyLabel] = {
		limited: true,
		lastError: reason || null,
		updatedAt: new Date().toISOString(),
	};
	state.date = today;
	await saveDailyState(filePath, state);
};

// ---------- Service-level helpers (per provider) ----------

const isServiceLimitedToday = async (filePath, serviceName) => {
	const state = await loadDailyState(filePath);
	const meta = state.services?.[serviceName];
	return !!(meta && meta.limited === true);
};

const markServiceLimitedToday = async (filePath, serviceName, reason) => {
	const today = getTodayStr();
	const state = await loadDailyState(filePath);
	if (!state.services) state.services = {};
	state.services[serviceName] = {
		limited: true,
		lastError: reason || null,
		updatedAt: new Date().toISOString(),
	};
	state.date = today;
	await saveDailyState(filePath, state);
};

module.exports = {
	STATE_DIR,
	GOOGLE_IMAGE_STATE_FILE,
	FALLBACK_IMAGE_STATE_FILE,
	loadDailyState,
	saveDailyState,
	isKeyLimitedToday,
	markKeyLimitedToday,
	isServiceLimitedToday,
	markServiceLimitedToday,
};

