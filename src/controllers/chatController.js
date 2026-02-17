const ChatHistory = require('../models/ChatHistory');
const FridgeItem = require('../models/FridgeItem');
const {
	getGeminiModel,
	retryWithAllKeys,
	getAllApiKeys,
	getCurrentKeyIndex,
	setKeyByIndex,
	saveApiKeyState,
	loadApiKeyState,
	is429Error,
} = require('../config/gemini');
const { logEvent, buildRequestContext } = require('../utils/logger');

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
			const ctx = buildRequestContext(req);
			logEvent('chat_send', {
				...ctx,
				success: false,
				statusCode: 400,
				reason: 'empty_message',
			});
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

		const result = await retryWithAllKeys(async () => {
			const model = getGeminiModel();
			const chat = model.startChat({ history });
			return await chat.sendMessage(fullMessage);
		});

		saveApiKeyState(getCurrentKeyIndex());
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

		const ctx = buildRequestContext(req);
		logEvent('chat_send', {
			...ctx,
			success: true,
			statusCode: 200,
			messageLength: message.length,
			replyLength: reply.length,
		});

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
			const ctx = buildRequestContext(req);
			logEvent('chat_history', {
				...ctx,
				success: true,
				statusCode: 200,
				messagesCount: 0,
			});
			return res.json({ success: true, data: { messages: [] } });
		}
		const ctx = buildRequestContext(req);
		logEvent('chat_history', {
			...ctx,
			success: true,
			statusCode: 200,
			messagesCount: chatDoc.messages.length,
		});
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

const sendMessageStream = async (req, res, next) => {
	try {
		const { message } = req.body;
		const start = Date.now();
		if (!message || !message.trim()) {
			const ctx = buildRequestContext(req);
			logEvent('chat_send_stream', {
				...ctx,
				success: false,
				statusCode: 400,
				reason: 'empty_message',
			});
			return res
				.status(400)
				.json({ success: false, message: 'Pesan tidak boleh kosong.' });
		}

		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Connection', 'keep-alive');
		res.setHeader('X-Accel-Buffering', 'no');
		res.flushHeaders?.();

		res.write(`data: ${JSON.stringify({ status: 'connected' })}\n\n`);
		if (typeof res.flush === 'function') res.flush();

		const [fridgeItems, chatDoc] = await Promise.all([
			FridgeItem.find({ user_id: req.user._id }),
			ChatHistory.findOne({ user_id: req.user._id }),
		]);

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

		const keys = getAllApiKeys();
		if (keys.length === 0) throw new Error('Tidak ada GOOGLE_API_KEY yang tersedia');

		let finalReply = '';
		const startIndex = loadApiKeyState();
		for (let i = 0; i < keys.length; i++) {
			const keyIndex = (startIndex + i) % keys.length;
			try {
				setKeyByIndex(keyIndex);
				const model = getGeminiModel();
				const chat = model.startChat({ history });
				const result = await chat.sendMessageStream(fullMessage);

				for await (const chunk of result.stream) {
					const chunkText = chunk.text?.() ?? '';
					if (chunkText) {
						res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
						if (typeof res.flush === 'function') res.flush();
					}
				}

				const finalResponse = await result.response;
				finalReply = finalResponse?.text?.() ?? '';
				saveApiKeyState(keyIndex);
				break;
			} catch (error) {
				console.error(
					`Error dengan GOOGLE_API_KEY${keyIndex === 0 ? '' : keyIndex} (index ${keyIndex}):`,
					error.message,
				);
				if (is429Error(error) && i < keys.length - 1) {
					const next = (startIndex + i + 1) % keys.length;
					console.log(`[429/limit] Mencoba key berikutnya: index ${next} (${i + 2}/${keys.length})...`);
					continue;
				}
				throw error;
			}
		}

		const newUserMsg = {
			role: 'user',
			content: message,
			timestamp: new Date(),
		};
		const newModelMsg = {
			role: 'model',
			content: finalReply,
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

		res.write(`data: ${JSON.stringify({ done: true, fullReply })}\n\n`);
		if (typeof res.flush === 'function') res.flush();
		res.end();

		const ctx = buildRequestContext(req);
		const durationMs = Date.now() - start;
		logEvent('chat_send_stream', {
			...ctx,
			success: true,
			statusCode: 200,
			messageLength: message.length,
			replyLength: finalReply.length,
			durationMs,
		});
	} catch (error) {
		if (!res.headersSent) {
			res.setHeader('Content-Type', 'text/event-stream');
			res.flushHeaders?.();
		}
		try {
			res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
			if (typeof res.flush === 'function') res.flush();
			res.end();
		} catch (e) {
			next(error);
		}
		const ctx = buildRequestContext(req);
		logEvent('chat_send_stream', {
			...ctx,
			success: false,
			statusCode: 500,
			reason: error.message,
		});
	}
};

const deleteHistory = async (req, res, next) => {
	try {
		await ChatHistory.findOneAndDelete({ user_id: req.user._id });
		const ctx = buildRequestContext(req);
		logEvent('chat_history_delete', {
			...ctx,
			success: true,
			statusCode: 200,
		});
		res.json({
			success: true,
			message: 'Riwayat chat berhasil dihapus.',
		});
	} catch (error) {
		next(error);
	}
};

module.exports = { sendMessage, sendMessageStream, getHistory, deleteHistory };
