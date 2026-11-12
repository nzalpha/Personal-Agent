import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from './config.ts';
import type { Store, Job } from './store.ts';
import { jevReaction } from './reactions.ts';

const linqBase = 'https://api.linqapp.com/api/partner/v3';
const auth = () => ({ Authorization: `Bearer ${config.linqKey}`, 'Content-Type': 'application/json' });

export function queryEmoji(text: string): string {
  if (/^\/voice(?:\s|$)/i.test(text)) return '🎙️';
  const topics: [RegExp, string][] = [
    [/\b(?:sushi|omakase|sashimi|nigiri)\b/i, '🍣'],
    [/\b(?:weather|forecast|rain|raining|temperature|snow|sunny)\b/i, '🌦️'],
    [/\b(?:food|dinner|lunch|breakfast|restaurant|eat|hungry|recipe)\b/i, '🍽️'],
    [/\b(?:code|coding|debug|bug|typescript|javascript|python|api|programming)\b/i, '💻'],
    [/\b(?:flight|travel|trip|hotel|vacation|airport|itinerary)\b/i, '✈️'],
    [/\b(?:music|song|songs|playlist|concert|album)\b/i, '🎵'],
    [/\b(?:nba|basketball)\b/i, '🏀'],
    [/\b(?:sports?|football|soccer|score|scores|match)\b/i, '🏟️'],
    [/\b(?:stocks?|investing|finance|markets?|earnings)\b/i, '📈'],
    [/\b(?:remember|memories|preferences)\b/i, '🧠'],
  ];
  return topics.find(([pattern]) => pattern.test(text))?.[1] || '👀';
}

export async function acknowledgeMessage(job: Job, request: typeof fetch = fetch): Promise<void> {
  const messageId = job.id.slice(job.chat.length + 1);
  if (!messageId || !job.id.startsWith(`${job.chat}:`)) throw new Error('Missing inbound message ID');
  let emoji: string | null = queryEmoji(job.text);
  if (config.reactionMode === 'jev') {
    try { emoji = await jevReaction(job.text, request); }
    catch { console.error('Jev reaction unavailable; using local emoji.'); }
  }
  if (emoji === null) return;
  const response = await request(`${linqBase}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST', headers: auth(), body: JSON.stringify({ operation: 'add', type: 'custom', custom_emoji: emoji }),
    signal: AbortSignal.timeout(3000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Reaction HTTP ${response.status}`);
}

export async function synthesizeSpeech(text: string, request: typeof fetch = fetch): Promise<Uint8Array> {
  const spoken = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!spoken) throw new Error('No text to speak');
  const key = process.env.OPENROUTER_API_KEY || (config.modelBaseUrl === 'https://openrouter.ai/api/v1' ? config.modelKey : '');
  if (!key) throw new Error('Set OPENROUTER_API_KEY for speech');
  const response = await request('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mistralai/voxtral-mini-tts-2603', voice: 'en_paul_neutral', input: spoken, response_format: 'mp3' }),
    signal: AbortSignal.timeout(60_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Speech HTTP ${response.status}`);
  if (response.headers.get('content-type')?.split(';')[0].trim() !== 'audio/mpeg') throw new Error('Speech did not return MP3 audio');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty speech response');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 5_000_000) { await reader.cancel(); throw new Error('Speech file too large'); }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 3 || !(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) throw new Error('Invalid MP3 bytes');
  return bytes;
}

export async function uploadAudio(bytes: Uint8Array, filename: string, request: typeof fetch = fetch): Promise<string> {
  const response = await request(`${linqBase}/attachments`, {
    method: 'POST', headers: auth(), body: JSON.stringify({ filename, content_type: 'audio/mpeg', size_bytes: bytes.length }),
    signal: AbortSignal.timeout(20_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Audio attachment HTTP ${response.status}`);
  const data = await response.json() as { upload_url: string; attachment_id: string; required_headers?: Record<string, string> };
  if (typeof data.attachment_id !== 'string' || !data.attachment_id || typeof data.upload_url !== 'string') throw new Error('Invalid upload response');
  const uploadUrl = new URL(data.upload_url);
  if (uploadUrl.protocol !== 'https:' || uploadUrl.username || uploadUrl.password) throw new Error('Upload requires HTTPS');
  // Only the returned upload headers go to the presigned storage URL.
  const uploaded = await request(uploadUrl, { method: 'PUT', headers: data.required_headers || { 'Content-Type': 'audio/mpeg' },
    body: Buffer.from(bytes), signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!uploaded.ok) throw new Error(`Audio upload HTTP ${uploaded.status}`);
  return data.attachment_id;
}

export async function sendVoiceReply(store: Store, chat: string, text: string, key: string, request: typeof fetch = fetch): Promise<void> {
  store.db.prepare('INSERT OR IGNORE INTO voice_replies(key) VALUES(?)').run(key);
  let state = store.db.prepare('SELECT attachment,state FROM voice_replies WHERE key=?').get(key) as { attachment: string | null; state: string };
  if (state.state === 'sent') return;
  if (state.state === 'sending') throw new Error('Voice delivery uncertain; review before retrying');
  const filename = `${createHash('sha256').update(key).digest('hex')}.mp3`;
  const directory = join(store.directory, 'audio'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, filename);
  if (!state.attachment) {
    if (!existsSync(path)) {
      const bytes = await synthesizeSpeech(text, request);
      writeFileSync(`${path}.tmp`, bytes, { mode: 0o600 }); renameSync(`${path}.tmp`, path);
    }
    const attachment = await uploadAudio(readFileSync(path), filename, request);
    store.db.prepare('UPDATE voice_replies SET attachment=? WHERE key=?').run(attachment, key);
    state = { ...state, attachment };
  }
  // The voice-memo endpoint documents no idempotency key. Never automatically
  // resend an ambiguous in-flight delivery after a crash or network failure.
  store.db.prepare("UPDATE voice_replies SET state='sending' WHERE key=?").run(key);
  const response = await request(`${linqBase}/chats/${encodeURIComponent(chat)}/voicememo`, {
    method: 'POST', headers: auth(), body: JSON.stringify({ attachment_id: state.attachment }),
    signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Voice memo HTTP ${response.status}`);
  store.db.prepare("UPDATE voice_replies SET state='sent' WHERE key=?").run(key);
}
