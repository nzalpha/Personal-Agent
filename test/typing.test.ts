import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTyping } from '../src/typing.ts';
import { Worker } from '../src/worker.ts';
import { Store } from '../src/store.ts';

test('typing refreshes and waits for an in-flight refresh before stopping once', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const calls: string[] = [];
  let release!: () => void;
  const stop = await startTyping('chat/id', async (url, init) => {
    assert.equal(String(url), 'https://api.linqapp.com/api/partner/v3/chats/chat%2Fid/typing');
    assert.ok(init?.signal);
    calls.push(init!.method!);
    if (calls.length === 2) await new Promise<void>(resolve => { release = resolve; });
    return new Response(null, { status: 204 });
  });
  t.mock.timers.tick(60_000);
  await Promise.resolve();
  assert.deepEqual(calls, ['POST', 'POST']);
  const stopped = stop();
  assert.deepEqual(calls, ['POST', 'POST']);
  release();
  await stopped;
  await stop();
  t.mock.timers.tick(120_000);
  await Promise.resolve();
  assert.deepEqual(calls, ['POST', 'POST', 'DELETE']);
});

test('typing HTTP and network errors are best effort', async () => {
  let calls = 0;
  const stop = await startTyping('chat', async () => {
    if (++calls === 1) return new Response(null, { status: 503 });
    throw new Error('offline');
  });
  await stop();
  assert.equal(calls, 2);
});

test('worker reacts before typing and clears typing after delivery or failure', async () => {
  for (const failure of ['none', 'generate', 'send', 'typing']) {
    const dir = mkdtempSync(join(tmpdir(), 'aie-typing-'));
    const store = new Store(dir);
    try {
      store.enqueue({ id: 'chat:message', event_id: 'event', chat: 'chat', sender: 'owner', text: 'Hello' });
      const order: string[] = [];
      const worker = new Worker(store, async () => {
        order.push('generate'); if (failure === 'generate') throw new Error('generation failed'); return 'Hi';
      }, async () => {
        order.push('send'); if (failure === 'send') throw new Error('delivery failed');
      }, async () => { order.push('react'); }, 'linq', async chat => {
        assert.equal(chat, 'chat'); order.push('start');
        if (failure === 'typing') throw new Error('typing failed');
        return async () => { order.push('stop'); };
      });
      await worker.tick();
      assert.deepEqual(order, failure === 'generate' ? ['react', 'start', 'generate', 'stop'] :
        failure === 'typing' ? ['react', 'start', 'generate', 'send'] : ['react', 'start', 'generate', 'send', 'stop']);
      assert.equal(worker.busy, false);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});
