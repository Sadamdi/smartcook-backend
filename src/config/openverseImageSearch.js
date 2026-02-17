const https = require('https');

const requestJson = (url, { headers = {} } = {}) =>
	new Promise((resolve, reject) => {
		https
			.get(
				url,
				{
					headers: {
						Accept: 'application/json',
						// Ikuti rekomendasi Openverse: sertakan identitas app + email kontak
						'User-Agent': 'SmartCook/1.0 (smartycook321@gmail.com)',
						...headers,
					},
				},
				(res) => {
					let raw = '';
					res.setEncoding('utf8');
					res.on('data', (c) => (raw += c));
					res.on('end', () => {
						const status = res.statusCode || 0;
						// Redirect handling will be done by wrapper
						if (status < 200 || status >= 300) {
							const err = new Error(`HTTP ${status}`);
							err.statusCode = status;
							err.body = raw;
							err.headers = res.headers;
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

const isRedirect = (code) => [301, 302, 303, 307, 308].includes(Number(code));

const requestJsonFollowRedirect = async (
	url,
	{ headers = {} } = {},
	maxHops = 3,
) => {
	let current = url;
	for (let hop = 0; hop <= maxHops; hop++) {
		try {
			return await requestJson(current, { headers });
		} catch (err) {
			const status = Number(err?.statusCode);
			if (isRedirect(status) && hop < maxHops) {
				const location = err?.headers?.location || err?.headers?.Location;
				if (location) {
					const next = new URL(location, current).toString();
					console.log(`[OpenverseImageSearch] Redirect ${status} -> ${next}`);
					current = next;
					continue;
				}
			}
			throw err;
		}
	}
	throw new Error('Too many redirects');
};

/**
 * Openverse image search (tanpa API key).
 * Return 1 URL image atau ''.
 *
 * Docs: https://api.openverse.engineering/v1/
 */
const searchOpenverseImageUrl = async (q) => {
	const query = String(q || '').trim();
	if (!query) return '';

	// Gunakan host resmi api.openverse.org (tanpa redirect)
	const url =
		`https://api.openverse.org/v1/images/` +
		`?q=${encodeURIComponent(query)}` +
		`&page_size=1` +
		`&filter_dead=true`;

	try {
		console.log(`[OpenverseImageSearch] Request q="${query}"`);
		const data = await requestJsonFollowRedirect(url);
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
		const loc = err?.headers?.location || err?.headers?.Location;
		console.warn(
			`[OpenverseImageSearch] Fail q="${query}" status=${err?.statusCode ?? '-'} location=${loc ?? '-'} msg="${err?.message ?? err}"`,
		);
		return '';
	}
};

module.exports = { searchOpenverseImageUrl };
