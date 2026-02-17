const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const initFirebase = () => {
	if (admin.apps.length > 0) return admin;

	let credential;

	const serviceAccountPath = path.join(
		__dirname,
		'..',
		'..',
		'serviceAccountKey.json',
	);
	const googleServicesPath = path.join(
		__dirname,
		'..',
		'..',
		'google-services.json',
	);

	if (fs.existsSync(serviceAccountPath)) {
		const serviceAccount = require(serviceAccountPath);
		credential = admin.credential.cert(serviceAccount);
	} else if (
		process.env.FIREBASE_PROJECT_ID &&
		process.env.FIREBASE_CLIENT_EMAIL &&
		process.env.FIREBASE_PRIVATE_KEY
	) {
		const rawKey = process.env.FIREBASE_PRIVATE_KEY;
		const normalizedKey = rawKey.replace(/\\n/g, '\n');

		if (normalizedKey.includes('YOUR_PRIVATE_KEY_HERE')) {
			console.error(
				'[Firebase] FIREBASE_PRIVATE_KEY masih placeholder (YOUR_PRIVATE_KEY_HERE).',
			);
			console.error(
				'Silakan isi dengan private key asli dari Service Account JSON di Firebase Console.',
			);
			throw new Error(
				'Konfigurasi Firebase belum lengkap: FIREBASE_PRIVATE_KEY masih placeholder.',
			);
		}

		credential = admin.credential.cert({
			projectId: process.env.FIREBASE_PROJECT_ID,
			clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
			privateKey: normalizedKey,
		});
	} else if (fs.existsSync(googleServicesPath)) {
		const googleServices = require(googleServicesPath);
		const projectId =
			googleServices.project_info?.project_id ||
			googleServices.project_info?.projectId;

		if (projectId) {
			console.log(
				`Using Firebase Project ID from google-services.json: ${projectId}`,
			);
			console.log(
				'WARNING: google-services.json tidak memiliki client_email dan private_key.',
			);
			console.log('Backend memerlukan Service Account JSON untuk autentikasi.');
			console.log(
				'Silakan download Service Account JSON dari Firebase Console:',
			);
			console.log(
				'Project Settings > Service Accounts > Generate New Private Key',
			);

			if (
				process.env.FIREBASE_CLIENT_EMAIL &&
				process.env.FIREBASE_PRIVATE_KEY
			) {
				credential = admin.credential.cert({
					projectId: projectId,
					clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
					privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
				});
			} else {
				throw new Error(
					'Firebase Admin SDK memerlukan FIREBASE_CLIENT_EMAIL dan FIREBASE_PRIVATE_KEY di .env atau serviceAccountKey.json',
				);
			}
		} else {
			throw new Error(
				'Tidak dapat menemukan project_id di google-services.json',
			);
		}
	} else {
		throw new Error(
			'Firebase config tidak ditemukan. Perlu serviceAccountKey.json atau environment variables di .env',
		);
	}

	admin.initializeApp({
		credential: credential,
	});

	return admin;
};

module.exports = { initFirebase, admin };
