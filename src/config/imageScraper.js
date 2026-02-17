const https = require('https');

// PERINGATAN:
// Scraper ini hanya contoh sederhana dan bisa melanggar ToS Google
// jika digunakan untuk trafik besar. Gunakan dengan bijak.

const DEFAULT_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36';

const fetchHtml = (url) =>
	new Promise((resolve, reject) => {
		https
			.get(
				url,
				{
					headers: {
						'User-Agent': DEFAULT_UA,
						Accept:
							'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
					},
				},
				(res) => {
					let raw = '';
					res.setEncoding('utf8');
					res.on('data', (c) => (raw += c));
					res.on('end', () => {
						const status = res.statusCode || 0;
						if (status < 200 || status >= 400) {
							const err = new Error(`HTTP ${status}`);
							err.statusCode = status;
							err.body = raw;
							return reject(err);
						}
						resolve(raw);
					});
				},
			)
			.on('error', reject);
	});

/**
 * Scrape 1 URL gambar dari Google Images (best-effort).
 * Hanya digunakan sebagai fallback terakhir jika semua provider resmi gagal.
 */
const scrapeImageUrlFromWeb = async (query) => {
	try {
		const q = String(query || '').trim();
		if (!q) return '';
		const url =
			'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q);
		console.log(`[ImageScraper] Request Google Images q="${q}"`);
		const html = await fetchHtml(url);

		// Cari pattern JSON yang berisi link gambar (rg_meta lama) ATAU langsung <img src="...">
		// Pattern sangat sederhana: cari https dan ekstensi gambar umum.
		const match = html.match(
			/(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp|gif))/i,
		);
		if (match && match[1]) {
			const img = match[1];
			console.log(`[ImageScraper] Found image url: ${img}`);
			return img;
		}
		console.log(`[ImageScraper] Tidak menemukan gambar untuk q="${q}"`);
		return '';
	} catch (err) {
		console.warn(
			`[ImageScraper] Gagal scrape untuk query: "${query}": ${err.message}`,
		);
		return '';
	}
};

module.exports = { scrapeImageUrlFromWeb };

