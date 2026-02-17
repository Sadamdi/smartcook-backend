const https = require('https');

const getAllSearchApiKeys = () => {
	const keys = [];
	if (process.env.SEARCH_API_KEY && process.env.SEARCH_API_KEY.trim()) {
		keys.push(process.env.SEARCH_API_KEY.trim());
	}
	for (let i = 1; i <= 10; i++) {
		const key = process.env[`SEARCH_API_KEY${i}`];
		if (key && key.trim()) keys.push(key.trim());
	}
	return keys;
};

const requestJson = (url) =>
	new Promise((resolve, reject) => {
		https
			.get(url, (res) => {
				let raw = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => (raw += chunk));
				res.on('end', () => {
					const status = res.statusCode || 0;
					if (status < 200 || status >= 300) {
						const err = new Error(`HTTP ${status}`);
						err.statusCode = status;
						err.body = raw;
						return reject(err);
					}
					try {
						const parsed = raw ? JSON.parse(raw) : null;
						return resolve(parsed);
					} catch (e) {
						const err = new Error('Invalid JSON response');
						err.statusCode = status;
						err.body = raw;
						return reject(err);
					}
				});
			})
			.on('error', reject);
	});

const looksLikeQuotaError = (err) => {
	if (!err) return false;
	const code = Number(err.statusCode);
	if (code === 429) return true;
	const body = typeof err.body === 'string' ? err.body : '';
	return (
		code === 403 &&
		(body.toLowerCase().includes('quota') ||
			body.toLowerCase().includes('rate') ||
			body.toLowerCase().includes('daily limit'))
	);
};

/**
 * Cari 1 URL gambar lewat Google Custom Search API (searchType=image).
 * Return string URL atau '' jika tidak ada/semua key gagal.
 */
const searchImageUrl = async (q, { safe = 'active' } = {}) => {
	const query = String(q || '').trim();
	if (!query) return '';

	const cx = (process.env.SEARCH_ENGINE_ID || '').trim();
	if (!cx) {
		console.warn('[GoogleImageSearch] SEARCH_ENGINE_ID belum diset di .env');
		return '';
	}

	const keys = getAllSearchApiKeys();
	if (keys.length === 0) {
		console.warn('[GoogleImageSearch] SEARCH_API_KEY belum diset di .env');
		return '';
	}

	const encodedQ = encodeURIComponent(query);

	let lastErr;
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const url =
			`https://www.googleapis.com/customsearch/v1` +
			`?searchType=image&num=1&safe=${encodeURIComponent(safe)}` +
			`&q=${encodedQ}&cx=${encodeURIComponent(cx)}&key=${encodeURIComponent(key)}`;

		try {
			const data = await requestJson(url);
			const items = data?.items;
			if (Array.isArray(items) && items.length > 0) {
				// CSE biasanya pakai 'link' untuk URL gambar
				const link = items[0]?.link || items[0]?.url;
				if (link && typeof link === 'string') return link;
			}
			return '';
		} catch (err) {
			lastErr = err;
			const label = i === 0 ? 'SEARCH_API_KEY' : `SEARCH_API_KEY${i}`;
			console.warn(
				`[GoogleImageSearch] Gagal dengan ${label} (index ${i}): ${err.message}`,
			);
			// Kalau quota/rate limit dan masih ada key lain, lanjut coba berikutnya
			if (looksLikeQuotaError(err) && i < keys.length - 1) continue;
			// Kalau error lain, tetap coba key berikutnya (lebih robust)
			if (i < keys.length - 1) continue;
		}
	}

	if (lastErr) {
		console.warn('[GoogleImageSearch] Semua key gagal:', lastErr.message);
	}
	return '';
};

module.exports = { searchImageUrl, getAllSearchApiKeys };

