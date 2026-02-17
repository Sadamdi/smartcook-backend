require('dotenv').config({
	path: require('path').join(__dirname, '..', '.env'),
});

const mongoose = require('mongoose');
const Recipe = require('./models/Recipe');
const Ingredient = require('./models/Ingredient');

const ingredients = [
	{
		name: 'Ayam utuh',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 500,
	},
	{
		name: 'Dada ayam',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 250,
	},
	{
		name: 'Paha ayam',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 250,
	},
	{
		name: 'Sayap ayam',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Daging bebek',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Daging sapi',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 250,
	},
	{
		name: 'Daging giling',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 250,
	},
	{
		name: 'Iga sapi',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 500,
	},
	{
		name: 'Daging kambing',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 250,
	},
	{
		name: 'Daging domba',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 250,
	},
	{
		name: 'Telur ayam',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'butir',
		common_quantity: 6,
	},
	{
		name: 'Telur bebek',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'butir',
		common_quantity: 6,
	},
	{
		name: 'Telur Puyuh',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'butir',
		common_quantity: 10,
	},
	{
		name: 'Sosis',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Bakso',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Nugget',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Kornet',
		category: 'protein',
		sub_category: 'Protein Hewani',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Ikan lele',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Ikan gurame',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Ikan patin',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Ikan mas',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Salmon',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Tongkol',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Kembung',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Tenggiri',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 250,
	},
	{
		name: 'Tuna',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Kakap',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Teri',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 100,
	},
	{
		name: 'Ikan asin',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 100,
	},
	{
		name: 'Udang',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Kepiting',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Lobster',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Cumi-cumi',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Sotong',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Gurita',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Kerang',
		category: 'protein',
		sub_category: 'Protein Seafood',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Tempe',
		category: 'protein',
		sub_category: 'Protein Nabati',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Tahu',
		category: 'protein',
		sub_category: 'Protein Nabati',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Oncom',
		category: 'protein',
		sub_category: 'Protein Nabati',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Kacang tanah',
		category: 'protein',
		sub_category: 'Protein Nabati',
		unit: 'gram',
		common_quantity: 100,
	},
	{
		name: 'Kacang hijau',
		category: 'protein',
		sub_category: 'Protein Nabati',
		unit: 'gram',
		common_quantity: 100,
	},
	{
		name: 'Kacang merah',
		category: 'protein',
		sub_category: 'Protein Nabati',
		unit: 'gram',
		common_quantity: 100,
	},
	{
		name: 'Kacang kedelai',
		category: 'protein',
		sub_category: 'Protein Nabati',
		unit: 'gram',
		common_quantity: 100,
	},
	{
		name: 'Edamame',
		category: 'protein',
		sub_category: 'Protein Nabati',
		unit: 'gram',
		common_quantity: 100,
	},
	{
		name: 'Jamur',
		category: 'protein',
		sub_category: 'Protein Nabati',
		unit: 'gram',
		common_quantity: 150,
	},
	{
		name: 'Wijen',
		category: 'protein',
		sub_category: 'Protein Nabati',
		unit: 'gram',
		common_quantity: 50,
	},
	{
		name: 'Beras',
		category: 'karbo',
		sub_category: 'Karbohidrat',
		unit: 'gram',
		common_quantity: 500,
	},
	{
		name: 'Kentang',
		category: 'karbo',
		sub_category: 'Karbohidrat',
		unit: 'gram',
		common_quantity: 300,
	},
	{
		name: 'Ubi',
		category: 'karbo',
		sub_category: 'Karbohidrat',
		unit: 'gram',
		common_quantity: 250,
	},
	{
		name: 'Jagung',
		category: 'karbo',
		sub_category: 'Karbohidrat',
		unit: 'tongkol',
		common_quantity: 2,
	},
	{
		name: 'Bayam',
		category: 'sayur',
		sub_category: 'Sayur-Mayur',
		unit: 'ikat',
		common_quantity: 1,
	},
	{
		name: 'Kangkung',
		category: 'sayur',
		sub_category: 'Sayur-Mayur',
		unit: 'ikat',
		common_quantity: 1,
	},
	{
		name: 'Wortel',
		category: 'sayur',
		sub_category: 'Sayur-Mayur',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Brokoli',
		category: 'sayur',
		sub_category: 'Sayur-Mayur',
		unit: 'gram',
		common_quantity: 200,
	},
	{
		name: 'Bawang Merah',
		category: 'bumbu',
		sub_category: 'Bumbu Dapur',
		unit: 'siung',
		common_quantity: 5,
	},
	{
		name: 'Bawang Putih',
		category: 'bumbu',
		sub_category: 'Bumbu Dapur',
		unit: 'siung',
		common_quantity: 3,
	},
	{
		name: 'Cabai',
		category: 'bumbu',
		sub_category: 'Bumbu Dapur',
		unit: 'buah',
		common_quantity: 5,
	},
	{
		name: 'Garam',
		category: 'bumbu',
		sub_category: 'Bumbu Dapur',
		unit: 'sdt',
		common_quantity: 1,
	},
];

const recipes = [
	{
		title: 'Jagung Sayur Kentang Bowl',
		description: 'Cocok untuk Diet, Diabetes, rendah gula. Harga hemat!',
		image_url: '',
		ingredients: [
			{ name: 'Jagung', quantity: '2', unit: 'tongkol' },
			{ name: 'Kentang', quantity: '200', unit: 'gram' },
			{ name: 'Wortel', quantity: '100', unit: 'gram' },
			{ name: 'Bayam', quantity: '1', unit: 'ikat' },
			{ name: 'Bawang Putih', quantity: '3', unit: 'siung' },
			{ name: 'Garam', quantity: '1', unit: 'sdt' },
		],
		steps: [
			{
				order: 1,
				instruction: 'Potong jagung, kentang, dan wortel sesuai selera.',
			},
			{
				order: 2,
				instruction: 'Rebus kentang dan wortel sampai empuk, tiriskan.',
			},
			{ order: 3, instruction: 'Tumis bawang putih hingga harum.' },
			{
				order: 4,
				instruction: 'Masukkan jagung, kentang, wortel, dan bayam. Aduk rata.',
			},
			{ order: 5, instruction: 'Tambahkan garam. Masak 5 menit.' },
			{ order: 6, instruction: 'Sajikan dalam mangkuk.' },
		],
		category: 'Healthy & Clean',
		meal_type: ['lunch', 'dinner'],
		tags: ['Healthy & Clean', 'Budget Friendly', 'Balanced Nutrition'],
		prep_time: 10,
		cook_time: 20,
		servings: 2,
		nutrition_info: { calories: 250, protein: 8, carbs: 45, fat: 5 },
		suitable_for: ['Diabetes', 'Diet'],
		not_suitable_for: [],
	},
	{
		title: 'Ayam Goreng Bumbu Kuning',
		description:
			'Ayam goreng klasik dengan bumbu kuning yang meresap. Cocok untuk makan siang keluarga.',
		image_url: '',
		ingredients: [
			{ name: 'Dada ayam', quantity: '500', unit: 'gram' },
			{ name: 'Bawang Putih', quantity: '5', unit: 'siung' },
			{ name: 'Bawang Merah', quantity: '4', unit: 'siung' },
			{ name: 'Garam', quantity: '1', unit: 'sdt' },
		],
		steps: [
			{
				order: 1,
				instruction: 'Haluskan bawang putih, bawang merah, dan bumbu lainnya.',
			},
			{
				order: 2,
				instruction:
					'Lumuri ayam dengan bumbu halus dan garam. Diamkan 30 menit.',
			},
			{ order: 3, instruction: 'Rebus ayam sampai bumbu meresap.' },
			{ order: 4, instruction: 'Angkat ayam, tiriskan.' },
			{
				order: 5,
				instruction: 'Goreng ayam dalam minyak panas sampai kuning keemasan.',
			},
			{ order: 6, instruction: 'Sajikan dengan nasi putih dan lalapan.' },
		],
		category: 'Indonesian Comfort',
		meal_type: ['lunch', 'dinner'],
		tags: ['Indonesian Comfort', 'Quick & Easy'],
		prep_time: 40,
		cook_time: 30,
		servings: 4,
		nutrition_info: { calories: 350, protein: 30, carbs: 5, fat: 22 },
		suitable_for: [],
		not_suitable_for: ['Kolesterol'],
	},
	{
		title: 'Tumis Kangkung',
		description: 'Sayuran sederhana yang lezat. Murah dan bergizi.',
		image_url: '',
		ingredients: [
			{ name: 'Kangkung', quantity: '2', unit: 'ikat' },
			{ name: 'Bawang Merah', quantity: '5', unit: 'siung' },
			{ name: 'Bawang Putih', quantity: '3', unit: 'siung' },
			{ name: 'Cabai', quantity: '5', unit: 'buah' },
			{ name: 'Garam', quantity: '1/2', unit: 'sdt' },
		],
		steps: [
			{ order: 1, instruction: 'Petik kangkung, cuci bersih, tiriskan.' },
			{ order: 2, instruction: 'Iris bawang merah, bawang putih, dan cabai.' },
			{
				order: 3,
				instruction: 'Panaskan minyak, tumis bawang dan cabai sampai harum.',
			},
			{
				order: 4,
				instruction: 'Masukkan kangkung, aduk cepat dengan api besar.',
			},
			{ order: 5, instruction: 'Tambahkan garam.' },
			{
				order: 6,
				instruction: 'Aduk rata, masak 2-3 menit. Angkat dan sajikan.',
			},
		],
		category: 'Quick & Easy',
		meal_type: ['lunch', 'dinner'],
		tags: ['Quick & Easy', 'Budget Friendly', 'Indonesian Comfort'],
		prep_time: 5,
		cook_time: 5,
		servings: 2,
		nutrition_info: { calories: 80, protein: 3, carbs: 10, fat: 4 },
		suitable_for: ['Diet', 'Diabetes'],
		not_suitable_for: [],
	},
	{
		title: 'Nasi Goreng Spesial',
		description:
			'Nasi goreng khas Indonesia dengan telur dan sayuran. Cocok untuk sarapan atau makan malam.',
		image_url: '',
		ingredients: [
			{ name: 'Beras', quantity: '400', unit: 'gram' },
			{ name: 'Telur ayam', quantity: '2', unit: 'butir' },
			{ name: 'Bawang Merah', quantity: '4', unit: 'siung' },
			{ name: 'Bawang Putih', quantity: '3', unit: 'siung' },
			{ name: 'Cabai', quantity: '3', unit: 'buah' },
			{ name: 'Garam', quantity: '1/2', unit: 'sdt' },
			{ name: 'Wortel', quantity: '50', unit: 'gram' },
		],
		steps: [
			{ order: 1, instruction: 'Iris bawang merah, bawang putih, dan cabai.' },
			{ order: 2, instruction: 'Potong kecil wortel.' },
			{
				order: 3,
				instruction: 'Panaskan minyak, tumis bumbu iris sampai harum.',
			},
			{ order: 4, instruction: 'Masukkan telur, orak-arik.' },
			{ order: 5, instruction: 'Tambahkan wortel, tumis sebentar.' },
			{
				order: 6,
				instruction: 'Masukkan nasi dan garam. Aduk rata dengan api besar.',
			},
			{
				order: 7,
				instruction: 'Masak sampai nasi tercampur rata dan sedikit kering.',
			},
			{ order: 8, instruction: 'Sajikan dengan pelengkap sesuai selera.' },
		],
		category: 'Quick & Easy',
		meal_type: ['breakfast', 'dinner'],
		tags: ['Quick & Easy', 'Indonesian Comfort', 'Budget Friendly'],
		prep_time: 10,
		cook_time: 10,
		servings: 2,
		nutrition_info: { calories: 450, protein: 15, carbs: 65, fat: 15 },
		suitable_for: [],
		not_suitable_for: ['Diabetes'],
	},
	{
		title: 'Sop Ayam Bening',
		description:
			'Sup ayam segar dengan sayuran. Hangat dan menyehatkan, cocok saat cuaca dingin.',
		image_url: '',
		ingredients: [
			{ name: 'Dada ayam', quantity: '300', unit: 'gram' },
			{ name: 'Wortel', quantity: '100', unit: 'gram' },
			{ name: 'Kentang', quantity: '150', unit: 'gram' },
			{ name: 'Bawang Putih', quantity: '3', unit: 'siung' },
			{ name: 'Bawang Merah', quantity: '3', unit: 'siung' },
			{ name: 'Garam', quantity: '1', unit: 'sdt' },
		],
		steps: [
			{
				order: 1,
				instruction: 'Rebus ayam sampai empuk, angkat dan suwir-suwir.',
			},
			{ order: 2, instruction: 'Saring kaldu ayam.' },
			{
				order: 3,
				instruction: 'Tumis bawang putih dan bawang merah sampai harum.',
			},
			{ order: 4, instruction: 'Masukkan tumisan ke dalam kaldu.' },
			{
				order: 5,
				instruction: 'Masukkan wortel dan kentang, masak sampai empuk.',
			},
			{ order: 6, instruction: 'Tambahkan ayam suwir. Beri garam.' },
			{ order: 7, instruction: 'Masak 5 menit lagi. Sajikan hangat.' },
		],
		category: 'Healthy & Clean',
		meal_type: ['lunch', 'dinner'],
		tags: ['Healthy & Clean', 'Indonesian Comfort', 'Balanced Nutrition'],
		prep_time: 15,
		cook_time: 40,
		servings: 4,
		nutrition_info: { calories: 200, protein: 20, carbs: 18, fat: 6 },
		suitable_for: ['Diet'],
		not_suitable_for: [],
	},
	{
		title: 'Omelette Sayuran',
		description:
			'Telur dadar tebal dengan isian sayuran segar. Sarapan sehat dan cepat.',
		image_url: '',
		ingredients: [
			{ name: 'Telur ayam', quantity: '3', unit: 'butir' },
			{ name: 'Wortel', quantity: '50', unit: 'gram' },
			{ name: 'Brokoli', quantity: '50', unit: 'gram' },
			{ name: 'Garam', quantity: '1/4', unit: 'sdt' },
		],
		steps: [
			{ order: 1, instruction: 'Potong kecil wortel dan brokoli.' },
			{ order: 2, instruction: 'Kocok telur dengan garam.' },
			{ order: 3, instruction: 'Panaskan sedikit minyak di teflon.' },
			{ order: 4, instruction: 'Tumis sayuran sebentar sampai layu.' },
			{ order: 5, instruction: 'Tuang telur kocok di atas sayuran.' },
			{
				order: 6,
				instruction: 'Masak dengan api kecil sampai bagian bawah matang.',
			},
			{
				order: 7,
				instruction: 'Lipat omelette, masak sebentar lagi. Sajikan.',
			},
		],
		category: 'Quick & Easy',
		meal_type: ['breakfast'],
		tags: ['Quick & Easy', 'Healthy & Clean', 'Balanced Nutrition'],
		prep_time: 5,
		cook_time: 10,
		servings: 1,
		nutrition_info: { calories: 280, protein: 20, carbs: 8, fat: 18 },
		suitable_for: ['Diet'],
		not_suitable_for: ['Kolesterol'],
	},
	{
		title: 'Rendang Daging Sapi',
		description:
			'Masakan khas Padang yang kaya rempah. Cocok untuk acara spesial.',
		image_url: '',
		ingredients: [
			{ name: 'Daging sapi', quantity: '500', unit: 'gram' },
			{ name: 'Bawang Merah', quantity: '8', unit: 'siung' },
			{ name: 'Bawang Putih', quantity: '5', unit: 'siung' },
			{ name: 'Cabai', quantity: '10', unit: 'buah' },
			{ name: 'Garam', quantity: '1', unit: 'sdt' },
		],
		steps: [
			{ order: 1, instruction: 'Potong daging sapi sesuai selera.' },
			{
				order: 2,
				instruction: 'Haluskan bawang merah, bawang putih, dan cabai.',
			},
			{ order: 3, instruction: 'Tumis bumbu halus sampai harum.' },
			{ order: 4, instruction: 'Masukkan daging, aduk rata dengan bumbu.' },
			{
				order: 5,
				instruction:
					'Tambahkan santan, masak dengan api sedang sambil sesekali diaduk.',
			},
			{ order: 6, instruction: 'Kecilkan api saat santan mulai menyusut.' },
			{
				order: 7,
				instruction:
					'Masak terus sampai santan habis dan daging berwarna coklat kehitaman.',
			},
			{ order: 8, instruction: 'Rendang siap disajikan.' },
		],
		category: 'Indonesian Comfort',
		meal_type: ['lunch', 'dinner'],
		tags: ['Indonesian Comfort', 'Pro Chef'],
		prep_time: 30,
		cook_time: 180,
		servings: 6,
		nutrition_info: { calories: 450, protein: 35, carbs: 8, fat: 32 },
		suitable_for: [],
		not_suitable_for: ['Kolesterol', 'Hipertensi', 'Asam Urat'],
	},
	{
		title: 'Pepes Tahu Jamur',
		description:
			'Tahu kukus dengan bumbu rempah dalam bungkus daun pisang. Plant based friendly.',
		image_url: '',
		ingredients: [
			{ name: 'Tahu', quantity: '300', unit: 'gram' },
			{ name: 'Jamur', quantity: '100', unit: 'gram' },
			{ name: 'Bawang Merah', quantity: '4', unit: 'siung' },
			{ name: 'Bawang Putih', quantity: '2', unit: 'siung' },
			{ name: 'Cabai', quantity: '3', unit: 'buah' },
			{ name: 'Garam', quantity: '1/2', unit: 'sdt' },
		],
		steps: [
			{ order: 1, instruction: 'Hancurkan tahu kasar.' },
			{
				order: 2,
				instruction: 'Iris halus bawang merah, bawang putih, dan cabai.',
			},
			{ order: 3, instruction: 'Iris jamur tipis-tipis.' },
			{
				order: 4,
				instruction: 'Campur tahu dengan jamur, bumbu iris, dan garam.',
			},
			{
				order: 5,
				instruction: 'Bungkus dengan daun pisang, semat dengan lidi.',
			},
			{ order: 6, instruction: 'Kukus selama 30 menit. Sajikan.' },
		],
		category: 'Healthy & Clean',
		meal_type: ['lunch', 'dinner'],
		tags: [
			'Healthy & Clean',
			'Plant Based',
			'Budget Friendly',
			'Indonesian Comfort',
		],
		prep_time: 15,
		cook_time: 35,
		servings: 3,
		nutrition_info: { calories: 120, protein: 10, carbs: 5, fat: 7 },
		suitable_for: ['Diet', 'Diabetes', 'Kolesterol'],
		not_suitable_for: ['Kedelai'],
	},
];

const seed = async () => {
	try {
		await mongoose.connect(process.env.MONGODB_URI);
		console.log('Connected to MongoDB');

		await Ingredient.deleteMany({});
		console.log('Cleared existing ingredients');

		await Recipe.deleteMany({});
		console.log('Cleared existing recipes');

		const createdIngredients = await Ingredient.insertMany(ingredients);
		console.log(`Seeded ${createdIngredients.length} ingredients`);

		const createdRecipes = await Recipe.insertMany(recipes);
		console.log(`Seeded ${createdRecipes.length} recipes`);

		console.log('Seed completed successfully!');
		process.exit(0);
	} catch (error) {
		console.error('Seed failed:', error.message);
		process.exit(1);
	}
};

seed();
