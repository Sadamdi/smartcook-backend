#!/usr/bin/env node
/**
 * Smoke-test the live /api/auth/google endpoint. Doesn't start the server
 * and doesn't touch the local repo's git state.
 *
 * Expected:
 *   1) POST {} with empty body  -> 400, message contains "UID dan email"
 *   2) POST with idToken:"junk"  -> 401, code INVALID_GOOGLE_TOKEN
 *
 * Run from anywhere: `node scripts/smoke-google.js`
 */

const https = require('https');

const HOST = 'api.himatif-encoder.com';
const API_KEY = process.env.SMOKE_API_KEY;
if (!API_KEY) {
	console.error('Set SMOKE_API_KEY (a session access token) before running.');
	process.exit(2);
}

const cases = [
	{
		name: 'empty body',
		body: {},
		expectStatus: 400,
		expectMessageIncludes: 'UID dan email',
	},
	{
		name: 'garbage idToken',
		body: {
			email: 'probe.frontend.link@gmail.com',
			uid: 'xxx',
			name: 'Probe',
			idToken: 'junk',
		},
		expectStatus: 401,
		expectCode: 'INVALID_GOOGLE_TOKEN',
	},
];

const post = (path, body) =>
	new Promise((resolve, reject) => {
		const data = Buffer.from(JSON.stringify(body));
		const req = https.request(
			{
				hostname: HOST,
				path,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': data.length,
					'x-api-key': API_KEY,
					'User-Agent': 'smartcook-smoke/1.0',
				},
				timeout: 15000,
			},
			(res) => {
				const chunks = [];
				res.on('data', (c) => chunks.push(c));
				res.on('end', () => {
					const raw = Buffer.concat(chunks).toString('utf8');
					resolve({ status: res.statusCode, headers: res.headers, raw });
				});
			},
		);
		req.on('error', reject);
		req.on('timeout', () => {
			req.destroy(new Error('timeout'));
		});
		req.write(data);
		req.end();
	});

const safeJson = (raw) => {
	try {
		return JSON.parse(raw);
	} catch (_) {
		return null;
	}
};

const run = async () => {
	let failures = 0;
	console.log(`# smoke /api/auth/google @ ${HOST}`);
	for (const c of cases) {
		let res;
		try {
			res = await post('/api/auth/google', c.body);
		} catch (err) {
			console.error(`[FAIL] ${c.name}: ${err.message}`);
			failures += 1;
			continue;
		}
		const json = safeJson(res.raw);
		console.log('---');
		console.log(`case: ${c.name}`);
		console.log(`status: ${res.status}`);
		console.log(`body: ${res.raw}`);
		if (res.status !== c.expectStatus) {
			console.error(
				`[FAIL] expected status ${c.expectStatus}, got ${res.status}`,
			);
			failures += 1;
		}
		if (c.expectMessageIncludes && json && typeof json.message === 'string') {
			if (!json.message.includes(c.expectMessageIncludes)) {
				console.error(
					`[FAIL] expected message to include "${c.expectMessageIncludes}"`,
				);
				failures += 1;
			}
		}
		if (c.expectCode && json && json.code !== c.expectCode) {
			console.error(
				`[FAIL] expected code ${c.expectCode}, got ${json.code}`,
			);
			failures += 1;
		}
	}
	console.log('---');
	if (failures > 0) {
		console.error(`smoke FAILED (${failures} failures)`);
		process.exit(1);
	}
	console.log('smoke OK');
};

run().catch((err) => {
	console.error('smoke threw:', err);
	process.exit(1);
});
