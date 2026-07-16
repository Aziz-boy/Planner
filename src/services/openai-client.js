const OpenAI = require('openai');
const config = require('../config');

let openai = null;
if (config.openaiApiKey) {
  try {
    openai = new OpenAI({
      apiKey: config.openaiApiKey,
      timeout: 90000,
      maxRetries: 1,
    });
  } catch (error) {
    console.error('OpenAI initialization failed:', error.message);
  }
}

function requireOpenAI() {
  if (!openai) {
    const error = new Error('OpenAI is not configured on the server.');
    error.statusCode = 503;
    throw error;
  }
  return openai;
}

module.exports = {
  openai,
  model: config.openaiModel,
  isOpenAIConfigured: () => Boolean(openai),
  requireOpenAI,
};
