const https = require('https');

const requestJson = (url, { headers = {} } = {}) =>
	new Promise((resolve, reject) => {
		https
			.get(
				url,
				{
					headers: {
						Accept: 'application/json',
						'User-Agent': 'SmartCook/1.0 (image search)',
						...headers,
					},
				},
				(res) => {
					let raw = '';
					res.setEncoding('utf8');
					res.on('data', (c) => (raw += c));
					res.on('end', () => {
						const status = res.statusCode || 0;
						if (status < 200 || status >= 300) {
							const err = new Error(`HTTP ${status}`);
							err.statusCode = status;
							err.body = raw;
							return reject(err);
						}
						try {
							return resolve(raw ? JSON.parse(raw) : null);
						} catch (e) {
							const err = new Error('Invalid JSON response');
							err.statusCode = status;
							err.body = raw;
							return reject(err);
						}
					});
				},
			)
			.on('error', reject);
	});

/**
 * Openverse image search (tanpa API key).
 * Return 1 URL image atau ''.
 *
 * Docs: https://api.openverse.engineering/v1/
 */
const searchOpenverseImageUrl = async (q) => {
	const query = String(q || '').trim();
	if (!query) return '';

	const url =
		`https://api.openverse.engineering/v1/images` +
		`?q=${encodeURIComponent(query)}` +
		`&page_size=1` +
		`&license_type=commercial` +
		`&filter_dead=true`;

	try {
		console.log(`[OpenverseImageSearch] Request q="${query}"`);
		const data = await requestJson(url);
		const results = data?.results;
		if (Array.isArray(results) && results.length > 0) {
			const r = results[0];
			// Prefer direct image url if present; fallback thumbnail
			const img = r?.url || r?.thumbnail || '';
			if (img) {
				console.log(`[OpenverseImageSearch] Success -> ${img}`);
				return img;
			}
		}
		console.log(`[OpenverseImageSearch] No results untuk q="${query}"`);
		return '';
	} catch (err) {
		console.warn(
			`[OpenverseImageSearch] Fail q="${query}" status=${err?.statusCode ?? '-'} msg="${err?.message ?? err}"`,
		);
		return '';
	}
};

module.exports = { searchOpenverseImageUrl };

