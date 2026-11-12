import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acknowledgeMessage, queryEmoji, synthesizeSpeech, sendVoiceReply } from '../src/extras.ts';
import { config } from '../src/config.ts';
import { Store, type Job } from '../src/store.ts';
import { Worker } from '../src/worker.ts';
import { isVoiceRequest, messageSummary } from '../src/response.ts';
const job: Job = { id: 'chat:message', event_id: 'event', chat: 'chat', sender: 'owner', text: 'Hello', reply: null, attempts: 0, next_at: 0, state: 'pending' };
const audio = Buffer.from('ID3mock-mp3-audio');
test('natural voice requests trigger audio, while educational questions stay text', () => {
  for (const text of ['/voice hello', 'Send me a voice note', 'Read that aloud', 'Can you reply with a voice message?', 'voice note please']) {
    // "voice message" is an ordinary synonym for a voice note.
    assert.equal(isVoiceRequest(text), true, text);
  }
  assert.equal(isVoiceRequest('How do voice notes work?'), false);
  assert.equal(isVoiceRequest('How can I send voice notes with Linq?'), false);
  assert.equal(isVoiceRequest('Find sushi in SF'), false);
  assert.equal(messageSummary('Sunny in SF.\nhttps://exa.ai/library/weather/sf'), 'Sunny in SF.');
  assert.equal(messageSummary('Sources:\nhttps://exa.ai/library/weather/sf'), '');
});
test('acknowledgment emoji follows the query with a predictable fallback', () => {
  assert.equal(queryEmoji('Find sushi in SF'), '🍣');
  assert.equal(queryEmoji('WEATHER in SF tomorrow?'), '🌦️');
  assert.equal(queryEmoji('Help debug this TypeScript API'), '💻');
  assert.equal(queryEmoji('/voice Find sushi nearby'), '🎙️');
  assert.equal(queryEmoji('Find a flight to London'), '✈️');
  assert.equal(queryEmoji('/remember my preferences'), '🧠');
  assert.equal(queryEmoji('Hello there'), '👀');
  assert.equal(queryEmoji('Describe a marketable skill'), '👀');
});
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aie-voice-test-')); const store = new Store(dir);
  const previous = { modelKey: config.modelKey, modelBaseUrl: config.modelBaseUrl };
  config.modelKey = 'fake-key'; config.modelBaseUrl = 'https://openrouter.ai/api/v1';
  t.after(() => { Object.assign(config, previous); store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}

test('emoji acknowledgment targets the inbound message, using a short timeout', async () => {
  await acknowledgeMessage(job, async (url, init) => {
    assert.equal(String(url), 'https://api.linqapp.com/api/partner/v3/messages/message/reactions');
    assert.deepEqual(JSON.parse(String(init?.body)), { operation: 'add', type: 'custom', custom_emoji: '👀' });
    assert.ok(init?.signal);
    return Response.json({});
  });
});

test('reaction failure does not prevent generating and delivering an answer', async t => {
  const store = fixture(t); store.enqueue(job); const order: string[] = [];
  const worker = new Worker(store, async () => { order.push('generate'); return 'Hello'; }, async () => { order.push('send'); }, async () => { order.push('react'); throw new Error('failed'); });
  await worker.tick(); assert.deepEqual(order, ['react', 'generate', 'send']); assert.equal(store.next(), undefined);
});

test('voice replies synthesize once, upload without bearer leakage, and persist successful delivery', async t => {
  const store = fixture(t); const calls: string[] = [];
  const request: typeof fetch = async (url, init) => {
    const u = String(url); calls.push(u);
    if (u.endsWith('/audio/speech')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'mistralai/voxtral-mini-tts-2603'); assert.equal(body.voice, 'en_paul_neutral');
      assert.equal(body.response_format, 'mp3'); assert.ok(!body.input.includes('https://'));
      return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } });
    }
    if (u.endsWith('/attachments')) return Response.json({ attachment_id: 'attachment', upload_url: 'https://uploads.example/audio', required_headers: { 'Content-Type': 'audio/mpeg', 'x-upload': 'required' } });
    if (u === 'https://uploads.example/audio') {
      assert.equal(new Headers(init?.headers).get('Authorization'), null);
      assert.equal(new Headers(init?.headers).get('x-upload'), 'required'); assert.deepEqual(Buffer.from(init?.body as Uint8Array), audio);
      return new Response(null, { status: 200 });
    }
    assert.ok(u.endsWith('/chats/chat/voicememo'));
    assert.deepEqual(JSON.parse(String(init?.body)), { attachment_id: 'attachment' });
    return Response.json({});
  };
  await sendVoiceReply(store, 'chat', 'Hello. https://example.com', 'voice-job', request);
  await sendVoiceReply(store, 'chat', 'Hello. https://example.com', 'voice-job', request);
  assert.equal(calls.length, 4);
});

test('ambiguous voice delivery never resends or regenerates on retry', async t => {
  const store = fixture(t); let sends = 0, generations = 0;
  const request: typeof fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/audio/speech')) { generations++; return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } }); }
    if (u.endsWith('/attachments')) return Response.json({ attachment_id: 'attachment', upload_url: 'https://uploads.example/audio' });
    if (u === 'https://uploads.example/audio') return new Response(null, { status: 200 });
    sends++; throw new Error('Connection lost after sending');
  };
  await assert.rejects(sendVoiceReply(store, 'chat', 'Hello.', 'uncertain', request));
  await assert.rejects(sendVoiceReply(store, 'chat', 'Hello.', 'uncertain', request), /uncertain/);
  assert.equal(sends, 1); assert.equal(generations, 1);
});

test('speech refuses JSON errors and invalid audio even on HTTP 200', async t => {
  fixture(t);
  await assert.rejects(synthesizeSpeech('Hello', async () => Response.json({ error: 'bad' })), /MP3/);
  await assert.rejects(synthesizeSpeech('Hello', async () => new Response('not an mp3', { headers: { 'Content-Type': 'audio/mpeg' } })), /Invalid MP3/);
});
