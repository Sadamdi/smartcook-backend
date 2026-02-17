const {
	searchImageUrl: searchGoogleImageUrl,
} = require('../config/googleImageSearch');
const { searchOpenverseImageUrl } = require('../config/openverseImageSearch');
const { scrapeImageUrlFromWeb } = require('../config/imageScraper');
const {
	FALLBACK_IMAGE_STATE_FILE,
	isServiceLimitedToday,
	markServiceLimitedToday,
} = require('../utils/jsonStateStore');

const normalizeQuery = (q) => String(q || '').trim();

/**
 * Wrapper utama untuk cari 1 URL gambar.
 * Urutan: Google → Openverse → Scraper → '' (dummy nanti ditangani frontend/UI).
 * Menghormati state harian per-service supaya tidak spam API kalau sudah error/limit.
 */
const searchBestImageUrl = async (q, options = {}) => {
	const query = normalizeQuery(q);
	if (!query) return '';

	// 1) Google Custom Search (state limit dikelola di modul googleImageSearch sendiri)
	try {
		const googleUrl = await searchGoogleImageUrl(query, options);
		if (googleUrl) return googleUrl;
	} catch (err) {
		// Biasanya sudah ditangani & di-log di modul googleImageSearch
		console.warn(
			`[ImageSearchService] Google search error untuk "${query}": ${err.message}`,
		);
	}

	// 2) Openverse (tanpa API key, tapi tetap kita bisa kasih cooldown harian kalau sering error)
	try {
		if (
			await isServiceLimitedToday(
				FALLBACK_IMAGE_STATE_FILE,
				'openverse-image',
			)
		) {
			console.log(
				`[ImageSearchService] Service openverse-image limited hari ini, skip "${query}"`,
			);
		} else {
			const openverseUrl = await searchOpenverseImageUrl(query);
			if (openverseUrl) return openverseUrl;
		}
	} catch (err) {
		console.warn(
			`[ImageSearchService] Openverse error untuk "${query}": ${err.message}`,
		);
		// Kalau sampai throw di sini, anggap service openverse bermasalah hari ini
		await markServiceLimitedToday(
			FALLBACK_IMAGE_STATE_FILE,
			'openverse-image',
			err.message,
		);
	}

	// 3) Scraper web (best-effort, juga bisa punya cooldown harian sendiri)
	try {
		if (
			await isServiceLimitedToday(FALLBACK_IMAGE_STATE_FILE, 'scraper-image')
		) {
			console.log(
				`[ImageSearchService] Service scraper-image limited hari ini, skip "${query}"`,
			);
		} else {
			const scrapedUrl = await scrapeImageUrlFromWeb(query);
			if (scrapedUrl) return scrapedUrl;
		}
	} catch (err) {
		console.warn(
			`[ImageSearchService] Scraper error untuk "${query}": ${err.message}`,
		);
		await markServiceLimitedToday(
			FALLBACK_IMAGE_STATE_FILE,
			'scraper-image',
			err.message,
		);
	}

	// 4) Semua gagal → biarkan empty string, frontend/backend bisa pakai dummy
	return '';
};

module.exports = {
	searchBestImageUrl,
};

