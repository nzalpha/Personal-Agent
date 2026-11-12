import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { config, assertReady } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { Worker, DeliveryReviewRequired } from '../src/worker.ts';
import { webhookServer } from '../src/http.ts';
import { answer } from '../src/agent.ts';
import { sendWhatsAppReply, verifyWhatsAppWebhook, whatsappJobs, whatsappTextParts } from '../src/whatsapp.ts';

const owner = '+12025550100', phoneNumberId = '123456789', appSecret = 'fake-app-secret';
const settings = { owner, phoneNumberId, accessToken: 'fake-token', apiVersion: 'v25.0' };
function message(id = 'wamid.1', body = 'Find dinner.') {
  return { from: owner.slice(1), id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } };
}
function event(messages: unknown[] = [message()]) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'account', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, messages,
  } }] }] };
}
function setup(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'aie-whatsapp-'));
  const store = new Store(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return store;
}
function signed(body: string) {
  return { 'x-hub-signature-256': `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}` };
}

test('WhatsApp validates the raw signature and rejects tampering, malformed signatures, and missing secrets', () => {
  const body = JSON.stringify(event());
  assert.equal(verifyWhatsAppWebhook(Buffer.from(body), signed(body), appSecret), true);
  assert.equal(verifyWhatsAppWebhook(Buffer.from(body + ' '), signed(body), appSecret), false);
  assert.equal(verifyWhatsAppWebhook(Buffer.from(body), signed(body), ''), false);
  for (const signature of ['', 'sha256=abc', `sha256=${'z'.repeat(64)}`]) {
    assert.equal(verifyWhatsAppWebhook(Buffer.from(body), { 'x-hub-signature-256': signature }, appSecret), false);
  }
});

test('WhatsApp extracts all batched text messages, isolates owner and line, and ignores unsupported events', () => {
  const batch = event([message(), { ...message('other'), from: '12025550999' },
    { ...message('audio'), type: 'audio' }, { ...message('group'), group_id: 'group' },
    { ...message('hidden'), from: undefined, from_user_id: 'US.hidden' }]);
  batch.entry.push(event([message('wamid.2')]).entry[0]);
  batch.entry[0].changes.push(event([message('wamid.3')]).entry[0].changes[0]);
  const jobs = whatsappJobs(batch, owner, phoneNumberId);
  assert.deepEqual(jobs.map(job => job.id), ['whatsapp:123456789:wamid.1', 'whatsapp:123456789:wamid.3', 'whatsapp:123456789:wamid.2']);
  assert.equal(jobs[0].sender, owner);
  assert.equal(jobs[0].chat, `whatsapp:${phoneNumberId}:${owner.slice(1)}`);
  assert.deepEqual(whatsappJobs(batch, owner, '999'), []);
  assert.deepEqual(whatsappJobs(batch, '+12025550888', phoneNumberId), []);
  assert.deepEqual(whatsappJobs({ object: 'other' }, owner, phoneNumberId), []);
  const receipt = event();
  const value: any = receipt.entry[0].changes[0].value;
  delete value.messages; value.statuses = [{ id: 'outbound', status: 'delivered' }];
  assert.deepEqual(whatsappJobs(receipt, owner, phoneNumberId), []);
  assert.throws(() => whatsappJobs(event([{ ...message(), id: null }]), owner, phoneNumberId));
  assert.equal(whatsappJobs(event([message('long', 'x'.repeat(8001))]), owner, phoneNumberId)[0].text, '/too-long');
});

test('WhatsApp HTTP verifies subscriptions, authenticates and deduplicates inbound messages, then runs the shared agent', async t => {
  const store = setup(t);
  let wakes = 0, sends = 0;
  const server = webhookServer(store, { channel: 'whatsapp', owner, phoneNumberId, appSecret, verifyToken: 'verify-me' }, () => { wakes++; });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const verified = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
    assert.equal(verified.status, 200); assert.equal(await verified.text(), '12345');
    assert.match(verified.headers.get('content-type')!, /text\/plain/);
    for (const query of ['hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123',
      'hub.mode=other&hub.verify_token=verify-me&hub.challenge=123', 'hub.mode=subscribe&hub.verify_token=verify-me']) {
      assert.equal((await fetch(`${base}/webhooks/whatsapp?${query}`)).status, 403);
    }
    assert.equal((await fetch(`${base}/webhooks/linq`, { method: 'POST', body: '{}' })).status, 404);
    const body = JSON.stringify(event([message('help', '/help'), message('hello', 'Hello')]));
    assert.equal((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', body })).status, 401);
    assert.equal((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', body: body + ' ', headers: signed(body) })).status, 401);
    assert.equal((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', body: '{', headers: signed('{') })).status, 400);
    const huge = 'x'.repeat(256 * 1024 + 1);
    assert.equal((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', body: huge, headers: signed(huge) })).status, 413);
    for (let i = 0; i < 2; i++) {
      assert.equal((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', body, headers: signed(body) })).status, 200);
    }
    assert.equal(wakes, 1); assert.equal(store.stats()[0].count, 2);
    const worker = new Worker(store, (scope, text) => answer(store, scope, text, { milestone: 1,
      complete: async () => ({ role: 'assistant', content: 'Hello back!' }) }),
    (chat, text, key, original) => sendWhatsAppReply(store, settings, chat, text, key, original, async () => {
      sends++; return Response.json({ messages: [{ id: `outbound-${sends}` }] });
    }), undefined, 'whatsapp');
    await worker.tick();
    assert.equal(sends, 2);
    assert.equal(store.history(owner).length, 4);
    assert.match(store.history(owner)[1].content, /\/remember/);
    assert.equal(store.history(owner)[3].content, 'Hello back!');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('WhatsApp text stays within the API limit and sends one source preview by default', () => {
  const text = `${'a'.repeat(4095)}😀${'b'.repeat(5000)}`;
  const parts = whatsappTextParts(text);
  assert.equal(parts.map(x => x.body).join(''), text);
  assert.ok(parts.every(x => x.body.length <= 4096 && x.body.isWellFormed()));
  const sources = 'Dinner. https://example.com/menu https://example.org/menu';
  assert.deepEqual(whatsappTextParts(sources), [
    { body: 'Dinner.', preview_url: false }, { body: 'https://example.com/menu', preview_url: true },
  ]);
  assert.equal(whatsappTextParts(sources, 'two sources').length, 3);
});

test('WhatsApp sends the Graph API payload and persists accepted parts across a database reopen', async t => {
  const store = setup(t), job = whatsappJobs(event(), owner, phoneNumberId)[0];
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fake-token');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), { messaging_product: 'whatsapp', recipient_type: 'individual',
      to: owner.slice(1), type: 'text', text: { body: calls === 1 ? 'Dinner.' : 'https://example.com/menu', preview_url: calls !== 1 } });
    return Response.json({ messages: [{ id: `wamid.out${calls}` }] });
  };
  const text = 'Dinner. https://example.com/menu';
  await sendWhatsAppReply(store, settings, job.chat, text, 'key', '', request);
  const reopened = new Store(store.directory);
  try { await sendWhatsAppReply(reopened, settings, job.chat, text, 'key', '', request); }
  finally { reopened.close(); }
  assert.equal(calls, 2);
  await assert.rejects(sendWhatsAppReply(store, settings, job.chat, 'changed', 'key', '', request), DeliveryReviewRequired);
  await assert.rejects(sendWhatsAppReply(store, settings, 'wrong-destination', text, 'other', '', request), DeliveryReviewRequired);
  assert.equal(calls, 2);
});

test('WhatsApp partial sends and network ambiguity are held without duplicate replies after restart', async t => {
  const store = setup(t), job = whatsappJobs(event(), owner, phoneNumberId)[0];
  store.enqueue(job);
  let calls = 0, generations = 0;
  const send = (chat: string, text: string, key: string) => sendWhatsAppReply(store, settings, chat, text, key, '', async () => {
    if (++calls === 2) throw new Error('Connection lost after accepting the message');
    return Response.json({ messages: [{ id: 'accepted' }] });
  });
  const worker = new Worker(store, async () => { generations++; return 'Dinner. https://example.com/menu'; }, send, undefined, 'whatsapp');
  await worker.tick(); await worker.tick(Date.now() + 100000);
  assert.equal(store.stats()[0].state, 'needs_review');
  assert.equal(calls, 2); assert.equal(generations, 1);
  assert.equal(store.history(owner).length, 0);
  const rows = store.db.prepare('SELECT state FROM whatsapp_outbox ORDER BY rowid').all();
  assert.deepEqual(rows.map(row => row.state), ['sent', 'sending']);
  const reopened = new Store(store.directory);
  try {
    const attempted = store.db.prepare('SELECT key FROM whatsapp_outbox ORDER BY rowid LIMIT 1').get()!.key as string;
    await assert.rejects(sendWhatsAppReply(reopened, settings, job.chat, 'Dinner. https://example.com/menu', attempted.slice(0, -2), '', async () => {
      assert.fail('An uncertain delivery must not be resent');
    }), DeliveryReviewRequired);
  } finally { reopened.close(); }
});

test('WhatsApp explicit API rejection and invalid acceptance are not silently retried', async t => {
  const store = setup(t), job = whatsappJobs(event(), owner, phoneNumberId)[0];
  for (const status of [400, 401, 429, 500, 200]) {
    let calls = 0;
    const request: typeof fetch = async () => { calls++; return Response.json({}, { status }); };
    for (let retry = 0; retry < 2; retry++) {
      await assert.rejects(sendWhatsAppReply(store, settings, job.chat, 'Hello', `key-${status}`, '', request), DeliveryReviewRequired);
    }
    assert.equal(calls, 1);
  }
});

test('switching channels leaves the other provider pending jobs untouched', async t => {
  const store = setup(t);
  store.enqueue(whatsappJobs(event(), owner, phoneNumberId)[0]);
  store.enqueue({ id: 'linq-1', event_id: 'linq-1', chat: 'linq-chat', sender: owner, text: 'Hello' });
  const sent: string[] = [];
  for (const channel of ['linq', 'whatsapp'] as const) {
    const worker = new Worker(store, async () => 'Hello', async chat => { sent.push(chat); }, undefined, channel);
    await worker.tick();
    if (channel === 'linq') assert.equal(store.next()?.chat, `whatsapp:${phoneNumberId}:${owner.slice(1)}`);
  }
  assert.deepEqual(sent, ['linq-chat', `whatsapp:${phoneNumberId}:${owner.slice(1)}`]);
});

test('phone config selects provider requirements without needing Linq credentials for WhatsApp', () => {
  const previous = { ...config };
  try {
    Object.assign(config, { milestone: 5, modelKey: 'fake', exaKey: 'fake', kernelKey: 'fake', owner,
      messagingChannel: 'whatsapp', whatsappToken: 'fake', whatsappPhoneNumberId: phoneNumberId,
      whatsappAppSecret: appSecret, whatsappVerifyToken: 'verify', whatsappApiVersion: 'v25.0',
      linqKey: '', line: '', webhookSecret: '' });
    assert.doesNotThrow(() => assertReady(true));
    config.whatsappAppSecret = ''; assert.throws(() => assertReady(true), /WHATSAPP_APP_SECRET/);
    config.whatsappAppSecret = appSecret;
    config.whatsappApiVersion = 'https://elsewhere.example'; assert.throws(() => assertReady(true), /WHATSAPP_API_VERSION/);
    config.whatsappApiVersion = 'v25.0';
    config.messagingChannel = 'linq'; assert.throws(() => assertReady(true), /LINQ_API_KEY/);
    config.messagingChannel = 'invalid'; assert.throws(() => assertReady(true), /MESSAGING_CHANNEL/);
  } finally {
    const { browserEnabled: _getter, ...values } = previous;
    Object.assign(config, values);
  }
});
