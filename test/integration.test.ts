import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { Mem0Memory } from '../src/memory.ts';
import { config } from '../src/config.ts';
import { webhookServer } from '../src/http.ts';

test('real Mem0 persists across workers and forgets without hosted inference', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workshop-mem0-'));
  const store = new Store(directory);
  const previous = {
    modelKey: config.modelKey, modelBaseUrl: config.modelBaseUrl,
    memoryEmbeddingBaseUrl: config.memoryEmbeddingBaseUrl, memoryDimensions: config.memoryDimensions,
  };
  let requests = 0;
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests++;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/embeddings') {
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      res.end(JSON.stringify({ data: inputs.map((_input: string, index: number) => ({ index, embedding: [1, 0] })) }));
    } else if (req.url === '/v1/chat/completions') {
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ memory: [{ id: '0', text: 'User is vegetarian.', attributed_to: 'user' }] }) } }] }));
    } else res.writeHead(400).end();
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
  Object.assign(config, { modelKey: 'fake-test-key', modelBaseUrl: base, memoryEmbeddingBaseUrl: base, memoryDimensions: 2 });
  try {
    const memory = new Mem0Memory(store);
    const saved = await memory.remember('owner', 'I am vegetarian.', AbortSignal.timeout(15_000));
    assert.equal(saved[0].memory, 'User is vegetarian.');
    const reopened = new Mem0Memory(store);
    assert.equal((await reopened.list('owner'))[0].memory, 'User is vegetarian.');
    assert.deepEqual(await reopened.list('other-owner'), []);
    const count = requests;
    assert.equal((await reopened.search('owner', 'Find dinner.', AbortSignal.timeout(15_000)))[0].memory, 'User is vegetarian.');
    store.addTurn('owner', 'user', 'I am vegetarian.');
    await reopened.forget('owner');
    assert.deepEqual(await reopened.list('owner'), []);
    assert.deepEqual(store.history('owner'), []);
    assert.equal(requests, count, 'small profile recall and deletion require no inference');
  } finally {
    Object.assign(config, previous);
    store.close();
    await new Promise<void>(resolve => provider.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP webhook rejects unsigned requests and durably deduplicates signed deliveries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workshop-webhook-'));
  const store = new Store(directory);
  const secret = `whsec_${Buffer.alloc(32, 3).toString('base64')}`;
  const owner = '+12025550100', line = '+12025550101';
  const server = webhookServer(store, { owner, line, secret }, () => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const body = JSON.stringify({ webhook_version: '2026-02-03', event_type: 'message.received', event_id: 'event-1', data: {
      id: 'message-1', direction: 'inbound', chat: { id: 'chat-1', is_group: false, owner_handle: { handle: line, is_me: true } },
      sender_handle: { handle: owner, is_me: false }, parts: [{ type: 'text', value: 'Find dinner.' }],
    } });
    assert.equal((await fetch(`${base}/webhooks/linq`, { method: 'POST', body })).status, 401);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', Buffer.alloc(32, 3)).update(`delivery-1.${timestamp}.${body}`).digest('base64');
    const headers = { 'webhook-id': 'delivery-1', 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` };
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await fetch(`${base}/webhooks/linq?version=2026-02-03`, { method: 'POST', body, headers })).status, 200);
    }
    assert.equal(store.next()?.text, 'Find dinner.');
    assert.equal(store.stats()[0].count, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
