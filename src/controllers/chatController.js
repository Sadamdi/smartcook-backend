const ChatHistory = require('../models/ChatHistory');
const FridgeItem = require('../models/FridgeItem');
const { getGeminiModel, retryWithAllKeys } = require('../config/gemini');

const buildUserContext = (user, fridgeItems) => {
	const parts = [];
	if (user.name) parts.push(`Nama pengguna: ${user.name}`);
	if (user.age_range) parts.push(`Usia: ${user.age_range}`);
	if (user.allergies && user.allergies.length > 0)
		parts.push(`Alergi makanan: ${user.allergies.join(', ')}`);
	if (user.medical_history && user.medical_history.length > 0)
		parts.push(`Riwayat penyakit: ${user.medical_history.join(', ')}`);
	if (user.cooking_styles && user.cooking_styles.length > 0)
		parts.push(`Gaya masak favorit: ${user.cooking_styles.join(', ')}`);
	if (user.equipment && user.equipment.length > 0)
		parts.push(`Peralatan dapur: ${user.equipment.join(', ')}`);
	if (fridgeItems.length > 0) {
		parts.push(
			`Bahan di kulkas: ${fridgeItems.map((i) => `${i.ingredient_name} (${i.quantity} ${i.unit})`).join(', ')}`,
		);
	}
	if (parts.length === 0) return '';
	return `\n\nKonteks pengguna:\n${parts.join('\n')}`;
};

const sendMessage = async (req, res, next) => {
	try {
		const { message } = req.body;
		if (!message || !message.trim()) {
			return res
				.status(400)
				.json({ success: false, message: 'Pesan tidak boleh kosong.' });
		}

		const fridgeItems = await FridgeItem.find({ user_id: req.user._id });
		let chatDoc = await ChatHistory.findOne({ user_id: req.user._id });
		let history = [];
		if (chatDoc && chatDoc.messages.length > 0) {
			const recent = chatDoc.messages.slice(-20);
			history = recent.map((msg) => ({
				role: msg.role,
				parts: [{ text: msg.content }],
			}));
		}

		const userContext = buildUserContext(req.user, fridgeItems);
		const fullMessage = userContext ? `${message}\n${userContext}` : message;

		// Retry dengan semua API key yang tersedia jika terjadi error
		const result = await retryWithAllKeys(async () => {
			const model = getGeminiModel();
			const chat = model.startChat({ history });
			return await chat.sendMessage(fullMessage);
		});

		const reply = result.response.text();

		const newUserMsg = {
			role: 'user',
			content: message,
			timestamp: new Date(),
		};
		const newModelMsg = {
			role: 'model',
			content: reply,
			timestamp: new Date(),
		};
		const allMessages = chatDoc
			? [...chatDoc.messages, newUserMsg, newModelMsg]
			: [newUserMsg, newModelMsg];

		await ChatHistory.findOneAndUpdate(
			{ user_id: req.user._id },
			{ messages: allMessages, updated_at: new Date() },
			{ upsert: true },
		);

		res.json({
			success: true,
			data: { reply, timestamp: new Date() },
		});
	} catch (error) {
		next(error);
	}
};

const getHistory = async (req, res, next) => {
	try {
		const chatDoc = await ChatHistory.findOne({ user_id: req.user._id });
		if (!chatDoc) {
			return res.json({ success: true, data: { messages: [] } });
		}
		res.json({
			success: true,
			data: {
				messages: chatDoc.messages,
				created_at: chatDoc.created_at,
				updated_at: chatDoc.updated_at,
			},
		});
	} catch (error) {
		next(error);
	}
};

const deleteHistory = async (req, res, next) => {
	try {
		await ChatHistory.findOneAndDelete({ user_id: req.user._id });
		res.json({
			success: true,
			message: 'Riwayat chat berhasil dihapus.',
		});
	} catch (error) {
		next(error);
	}
};

module.exports = { sendMessage, getHistory, deleteHistory };
