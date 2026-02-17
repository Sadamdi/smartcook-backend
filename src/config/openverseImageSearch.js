const https = require('https');

/**
 * Headers dasar untuk semua request ke Openverse.
 * - WAJIB: User-Agent berisi identitas app + kontak.
 * - OPSIONAL: Authorization Bearer token jika OPENVERSE_AUTH_TOKEN diset.
 * - OPSIONAL: client_id untuk tracking rate-limit jika OPENVERSE_CLIENT_ID diset.
 */
const buildBaseHeaders = () => {
	const headers = {
		Accept: 'application/json',
		// Ikuti rekomendasi Openverse: sertakan identitas app + email kontak
		'User-Agent': 'SmartCook/1.0 (smartycook321@gmail.com)',
	};

	if (process.env.OPENVERSE_AUTH_TOKEN) {
		headers.Authorization = `Bearer ${process.env.OPENVERSE_AUTH_TOKEN}`;
	}

	if (process.env.OPENVERSE_CLIENT_ID) {
		headers['X-Openverse-Client'] = process.env.OPENVERSE_CLIENT_ID;
	}

	return headers;
};

const requestJson = (url, { headers = {} } = {}) =>
	new Promise((resolve, reject) => {
		const finalHeaders = {
			...buildBaseHeaders(),
			...headers,
		};

		https
			.get(
				url,
				{
					headers: finalHeaders,
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

	// Gunakan host resmi api.openverse.org (tanpa redirect) dan paksa format JSON
	const url =
		`https://api.openverse.org/v1/images/` +
		`?q=${encodeURIComponent(query)}` +
		`&page_size=1` +
		`&filter_dead=true` +
		`&format=json`;

	try {
		console.log(`[OpenverseImageSearch] Request q="${query}"`);
		const data = await requestJsonFollowRedirect(url);
		const results = Array.isArray(data?.results) ? data.results : [];
		if (results.length > 0) {
			const r = results[0];
			// Prefer direct image url (field `url`), fallback ke `thumbnail` kalau perlu
			const img = (r && (r.url || r.thumbnail)) || '';
			if (img) {
				console.log(`[OpenverseImageSearch] Success -> ${img}`);
				return img;
			}
		}
		console.log(`[OpenverseImageSearch] No results untuk q="${query}"`);
		return '';
	} catch (err) {
		const loc = err?.headers?.location || err?.headers?.Location;
		const status = err?.statusCode ?? '-';
		let bodyPreview = '';
		if (err?.body) {
			const raw = String(err.body);
			bodyPreview = raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
		}
		console.warn(
			`[OpenverseImageSearch] Fail q="${query}" status=${status} location=${loc ?? '-'} msg="${err?.message ?? err}" body="${bodyPreview}"`,
		);
		return '';
	}
};

module.exports = { searchOpenverseImageUrl };
