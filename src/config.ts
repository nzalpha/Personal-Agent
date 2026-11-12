export const config = {
  milestone: Number(process.env.WORKSHOP_MILESTONE || 5),
  modelKey: process.env.MODEL_API_KEY || process.env.OPENROUTER_API_KEY || '',
  model: process.env.MODEL_NAME || 'qwen/qwen3.8-27b',
  modelBaseUrl: process.env.MODEL_BASE_URL || 'https://openrouter.ai/api/v1',
  exaKey: process.env.EXA_API_KEY || '',
  memoryEmbeddingModel: process.env.MEM0_EMBEDDING_MODEL || 'qwen/qwen3-embedding-4b',
  memoryEmbeddingBaseUrl: process.env.MEM0_EMBEDDING_BASE_URL || process.env.MODEL_BASE_URL || 'https://openrouter.ai/api/v1',
  memoryEmbeddingKey: process.env.MEM0_EMBEDDING_API_KEY || '',
  memoryDimensions: Number(process.env.MEM0_EMBEDDING_DIMENSIONS || 2560),
  timezone: process.env.AGENT_TIMEZONE || 'America/Los_Angeles',
  messagingChannel: process.env.MESSAGING_CHANNEL || 'linq',
  reactionMode: process.env.REACTION_MODE || 'local',
  whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || '',
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION || '',
  linqKey: process.env.LINQ_API_KEY || '',
  webhookSecret: process.env.LINQ_WEBHOOK_SECRET || '',
  owner: process.env.OWNER_PHONE_NUMBER || '',
  line: process.env.LINQ_PHONE_NUMBER || '',
  port: Number(process.env.PORT || 3400),
  dataDir: process.env.DATA_DIR || '.data',
  get browserEnabled() { return this.milestone >= 3; },
  kernelKey: process.env.KERNEL_API_KEY || '',
};

export function reactionKey(): string {
  return process.env.OPENROUTER_API_KEY || (config.modelBaseUrl === 'https://openrouter.ai/api/v1' ? config.modelKey : '');
}

export function modelEndpoint(base = config.modelBaseUrl): string {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Model endpoint must use HTTPS or local loopback HTTP.');
  }
  return `${url.href.replace(/\/$/, '')}/chat/completions`;
}

export function modelExtraBody(): Record<string, unknown> {
  return new URL(config.modelBaseUrl).hostname === 'openrouter.ai'
    ? { provider: { require_parameters: true }, reasoning: { enabled: false } } : {};
}

export function assertReady(channel = false): void {
  if (!Number.isInteger(config.milestone) || config.milestone < 1 || config.milestone > 5) throw new Error('WORKSHOP_MILESTONE must be 1–5.');
  if (!config.modelKey.trim()) throw new Error('Set OPENROUTER_API_KEY or MODEL_API_KEY in .env.');
  modelEndpoint();
  new Intl.DateTimeFormat('en', { timeZone: config.timezone });
  if (config.milestone >= 2 && !config.exaKey.trim()) throw new Error('Set EXA_API_KEY in .env.');
  if (config.milestone >= 4) {
    modelEndpoint(config.memoryEmbeddingBaseUrl);
    if (!Number.isInteger(config.memoryDimensions) || config.memoryDimensions < 1 || config.memoryDimensions > 8192) throw new Error('Invalid embedding dimensions.');
  }
  if (config.milestone >= 3 && !config.kernelKey.trim()) throw new Error('Set KERNEL_API_KEY for milestone 3 and later.');
  if (channel) {
    if (config.milestone < 5) throw new Error('Set WORKSHOP_MILESTONE=5 for phone messaging. Use npm run chat for milestones 1–4.');
    if (!['linq', 'whatsapp'].includes(config.messagingChannel)) throw new Error('Set MESSAGING_CHANNEL to linq or whatsapp.');
    if (!['local', 'jev'].includes(config.reactionMode)) throw new Error('Set REACTION_MODE to local or jev.');
    if (config.messagingChannel === 'linq' && config.reactionMode === 'jev' && !reactionKey().trim()) throw new Error('Set OPENROUTER_API_KEY for Jev reactions.');
    if (!/^\+[1-9]\d{7,14}$/.test(config.owner)) throw new Error('Set OWNER_PHONE_NUMBER in E.164 format.');
    if (config.messagingChannel === 'whatsapp') {
      if (!config.whatsappToken.trim()) throw new Error('Set WHATSAPP_ACCESS_TOKEN.');
      if (!/^\d+$/.test(config.whatsappPhoneNumberId)) throw new Error('Set WHATSAPP_PHONE_NUMBER_ID to the numeric Meta phone number ID.');
      if (!config.whatsappAppSecret.trim()) throw new Error('Set WHATSAPP_APP_SECRET from your Meta app.');
      if (!config.whatsappVerifyToken.trim()) throw new Error('Set WHATSAPP_VERIFY_TOKEN to your webhook verification token.');
      if (!/^v\d+\.0$/.test(config.whatsappApiVersion)) throw new Error('Set WHATSAPP_API_VERSION to a supported Graph API version from your Meta dashboard (vNN.0).');
    } else {
      if (!config.linqKey.trim()) throw new Error('Set LINQ_API_KEY.');
      if (Buffer.from(config.webhookSecret.replace(/^whsec_/, ''), 'base64').length < 16) throw new Error('Set LINQ_WEBHOOK_SECRET from your subscription.');
      if (!/^\+[1-9]\d{7,14}$/.test(config.line) || config.owner === config.line) throw new Error('Set distinct owner and Linq numbers in E.164 format.');
    }
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid PORT.');
  }
}
