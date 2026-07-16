const path = require('path');

module.exports = Object.freeze({
  port: Number(process.env.PORT) || 3000,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT || '',
  plannerUrl: process.env.PLANNER_URL || 'https://azizboyplan.netlify.app',
  subscriptionsFile: path.resolve(__dirname, '..', 'subscriptions.json'),
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    email: process.env.VAPID_EMAIL || 'mailto:shavgoniaziz@gmail.com',
  },
});
