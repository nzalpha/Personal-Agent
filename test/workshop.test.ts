import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { Worker } from '../src/worker.ts';
import { incomingJob, verifyWebhook, sendReply, replyLinks } from '../src/linq.ts';
import { answer, search, toolsFor } from '../src/agent.ts';
import type { Complete, ChatMessage } from '../src/model.ts';
import type { PersonalMemory } from '../src/memory.ts';
import { textingFormat, sourceCardLimit } from '../src/response.ts';

function setup(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-test-'));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}
const owner = '+12025550100', line = '+12025550101';
function event() {
  return { webhook_version: '2026-02-03', event_type: 'message.received', event_id: 'event-1', data: {
    id: 'message-1', direction: 'inbound', chat: { id: 'chat-1', is_group: false, owner_handle: { handle: line, is_me: true } },
    sender_handle: { handle: owner, is_me: false }, parts: [{ type: 'text', value: 'Find dinner.' }],
  } };
}
const toolCall = (name: string, args: unknown): ChatMessage => ({ role: 'assistant', content: null,
  tool_calls: [{ id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

test('milestones expose only enabled tools', () => {
  assert.deepEqual(toolsFor(1, false), []);
  assert.deepEqual(toolsFor(2, true).map(x => x.function.name), ['exa_search']);
  assert.deepEqual(toolsFor(3, true).map(x => x.function.name), ['exa_search', 'browse_page']);
  const memoryTools = ['remember_preference', 'list_memories', 'forget_memory', 'reset_conversation', 'agent_help'];
  assert.deepEqual(toolsFor(5, true).map(x => x.function.name), ['exa_search', 'browse_page', ...memoryTools]);
  assert.deepEqual(toolsFor(5, false).map(x => x.function.name), ['exa_search', ...memoryTools]);
});

test('signature validates original bytes, rejects tampering and stale requests', () => {
  const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
  const raw = Buffer.from(JSON.stringify(event()));
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac('sha256', Buffer.alloc(32, 7)).update(`delivery-1.${timestamp}.`).update(raw).digest('base64');
  const headers = { 'webhook-id': 'delivery-1', 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` };
  assert.equal(verifyWebhook(raw, headers, secret, now), true);
  assert.equal(verifyWebhook(Buffer.concat([raw, Buffer.from(' ')]), headers, secret, now), false);
  assert.equal(verifyWebhook(raw, headers, secret, now + 301_000), false);
});

test('accept only the configured owner direct inbound text on this line', () => {
  assert.equal(incomingJob(event(), owner, line)?.text, 'Find dinner.');
  assert.equal(incomingJob(event(), '+12025550999', line), null);
  const group = event(); group.data.chat.is_group = true;
  assert.equal(incomingJob(group, owner, line), null);
  const echo = event(); echo.data.direction = 'outbound';
  assert.equal(incomingJob(echo, owner, line), null);
  assert.throws(() => incomingJob({ ...event(), webhook_version: '2025-01-01' }, owner, line));
});

test('duplicate deliveries enqueue once and worker finishes one conversation turn', async t => {
  const store = setup(t);
  const job = incomingJob(event(), owner, line)!;
  assert.equal(store.enqueue(job), true);
  assert.equal(store.enqueue(job), false);
  let generated = 0, sent = 0;
  const worker = new Worker(store, async () => { generated++; return 'Try this menu.'; }, async () => { sent++; });
  await worker.tick();
  await worker.tick();
  assert.equal(generated, 1); assert.equal(sent, 1);
  assert.equal(store.history(owner).length, 2);
  assert.equal(store.stats()[0].state, 'accepted');
});

test('send retry reuses persisted answer and stable idempotency key', async t => {
  const store = setup(t);
  store.enqueue(incomingJob(event(), owner, line)!);
  let generated = 0, sends = 0;
  const keys: string[] = [];
  const worker = new Worker(store, async () => { generated++; return 'Saved reply.'; }, async (_chat, _text, key) => {
    keys.push(key); if (++sends === 1) throw new Error('Transient network failure');
  });
  await worker.tick();
  await worker.tick(Date.now() + 5000);
  assert.equal(generated, 1); assert.equal(sends, 2);
  assert.equal(keys[0], keys[1]); assert.equal(store.history(owner).length, 2);
});

test('Linq send puts idempotency inside the message body', async () => {
  const request: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.linqapp.com/api/partner/v3/chats/chat%2Fone/messages');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.message.idempotency_key, 'stable-key');
    assert.deepEqual(body.message.parts, [{ type: 'text', value: 'Hello.' }]);
    return new Response('{}', { status: 202 });
  };
  await sendReply('fake-token', 'chat/one', 'Hello.', 'stable-key', request);
});

test('source cards are separate HTTPS link messages, deduplicated and capped at three', async () => {
  const text = 'Read [menu](https://example.com/menu). Again https://example.com/menu\n' +
    'https://example.org/a_(b) and https://example.net/three, https://example.edu/four';
  const sent: any[] = [];
  await sendReply('fake', 'chat', text, 'reply-key', async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)).message);
    return Response.json({});
  }, replyLinks(text), 3);
  assert.equal(sent.length, 4);
  assert.equal(sent[0].parts[0].type, 'text');
  assert.ok(!sent[0].parts[0].value.includes('https://'));
  assert.deepEqual(sent.slice(1).map(m => m.parts), [
    [{ type: 'link', value: 'https://example.com/menu' }],
    [{ type: 'link', value: 'https://example.org/a_(b)' }],
    [{ type: 'link', value: 'https://example.net/three' }],
  ]);
  assert.equal(new Set(sent.map(m => m.idempotency_key)).size, 4);
  assert.deepEqual(replyLinks('http://example.com https://127.0.0.1/a https://host.local/x https://a:b@example.com/'), []);
  assert.deepEqual(replyLinks(`https://example.com/${'x'.repeat(2100)}`), []);
});

test('texting format removes Markdown and list markers while retaining source URLs', () => {
  const formatted = textingFormat('## Dinner\n**Robin** is worth a look.\n- Food: $150\n• Confirm the price.\n1. [Menu](https://example.com/menu)');
  assert.equal(formatted, 'Dinner\nRobin is worth a look.\n\nFood: $150\n\nConfirm the price.\n\nMenu: https://example.com/menu');
  assert.equal(textingFormat('Text me at 6.30.\nhttps://example.com/a_b?q=1'), 'Text me at 6.30.\nhttps://example.com/a_b?q=1');
});

test('the workshop text-only baseline disables cards explicitly', async () => {
  const messages: any[] = [];
  await sendReply('fake', 'chat', 'Menu: https://example.com/', 'before', async (_url, init) => {
    messages.push(JSON.parse(String(init?.body)).message);
    return Response.json({});
  }, []);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].parts[0].type, 'text');
});

test('a partial card send retries with identical card idempotency keys', async () => {
  const sent: any[] = [];
  let failed = false;
  const request: typeof fetch = async (_url, init) => {
    const message = JSON.parse(String(init?.body)).message;
    sent.push(message);
    if (!failed && message.parts[0].value === 'https://example.org/') {
      failed = true;
      return new Response('{}', { status: 503 });
    }
    return Response.json({});
  };
  const text = 'Sources: https://example.com/ https://example.org/';
  await assert.rejects(sendReply('fake', 'chat', text, 'stable-reply', request, replyLinks(text), 3), /503/);
  await sendReply('fake', 'chat', text, 'stable-reply', request, replyLinks(text), 3);
  assert.deepEqual(sent.slice(0, 2), sent.slice(2));
});

test('one source card is sent by default; multiple cards require an explicit request', async () => {
  const sent: any[] = [];
  await sendReply('fake', 'chat', 'https://example.com/a https://exa.ai/library/weather/sf https://example.org/b', 'key', async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)).message.parts[0]);
    return Response.json({});
  });
  assert.deepEqual(sent, [{ type: 'link', value: 'https://exa.ai/library/weather/sf' }]);
  assert.equal(sourceCardLimit('weather in SF'), 1);
  assert.equal(sourceCardLimit('include sources'), 1);
  assert.equal(sourceCardLimit('give me two options'), 2);
  assert.equal(sourceCardLimit('more sources please'), 3);
  assert.equal(sourceCardLimit('show 10 sources'), 3);
  assert.equal(sourceCardLimit("don't send multiple sources"), 1);
});

test('Exa Library cards are preferred before the card cap; lookalike hosts are not', () => {
  assert.deepEqual(replyLinks('https://one.example/a https://two.example/b https://three.example/c ' +
    'https://exa.ai/library/weather/sf?date=2026-11-07 https://exa.ai.evil.example/library/fake'), [
    'https://exa.ai/library/weather/sf?date=2026-11-07', 'https://one.example/a', 'https://two.example/b',
  ]);
});

test('search prioritizes returned Library sources without dropping other sources', async () => {
  const result = await search('SF weather', AbortSignal.timeout(1000), async () => Response.json({ results: [
    { title: 'Web', url: 'https://example.com/weather' },
    { title: 'Library', url: 'https://exa.ai/library/weather/sf' },
  ] })) as { results: { title: string }[] };
  assert.deepEqual(result.results.map(x => x.title), ['Library', 'Web']);
});

test('search requests highlights and bounds the returned evidence', async () => {
  const request: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.contents, { highlights: true });
    assert.equal(body.numResults, 5);
    return Response.json({ results: [{ url: 'https://example.com/menu', title: 'Menu', highlights: ['x'.repeat(5000)] }] });
  };
  const result = await search('dinner', AbortSignal.timeout(1000), request) as { results: { highlights: string[] }[] };
  assert.equal(result.results[0].highlights[0].length, 1200);
});

test('search result returns to model before the final answer', async t => {
  const store = setup(t);
  let calls = 0;
  const complete: Complete = async messages => {
    if (++calls === 1) return toolCall('exa_search', { query: 'SF dinner menu' });
    assert.equal(messages.at(-1)?.role, 'tool');
    assert.match(messages.at(-1)!.content!, /https:\/\/example.com\/menu/);
    return { role: 'assistant', content: 'Menu: https://example.com/menu' };
  };
  const result = await answer(store, owner, 'Find dinner.', { milestone: 2, complete,
    search: async () => ({ results: [{ url: 'https://example.com/menu', highlights: ['Vegetarian options.'] }] }),
  });
  assert.match(result, /example.com/); assert.equal(calls, 2);
});

test('disabled tools cannot invoke the search dependency', async t => {
  const store = setup(t);
  let calls = 0;
  await answer(store, owner, 'Find dinner.', { milestone: 1,
    complete: async messages => ++calls === 1 ? toolCall('exa_search', { query: 'dinner' }) :
      (assert.match(messages.at(-1)!.content!, /unavailable/), { role: 'assistant', content: 'Search is unavailable.' }),
    search: async () => { assert.fail('Disabled tool executed'); },
  });
});

test('explicit memory commands use owner scope; normal messages only recall', async t => {
  const store = setup(t);
  let saved = 0;
  const memory: PersonalMemory = {
    list: async scope => (assert.equal(scope, owner), [{ id: '1', memory: 'Vegetarian.' }]),
    search: async scope => (assert.equal(scope, owner), [{ id: '1', memory: 'Vegetarian.' }]),
    remember: async (scope, text) => { assert.equal(scope, owner); saved++; return [{ id: '1', memory: text }]; },
    forget: async scope => { assert.equal(scope, owner); },
  };
  assert.match(await answer(store, owner, '/remember Vegetarian.', { milestone: 4, memory }), /Saved:/);
  assert.match(await answer(store, owner, '/memories', { milestone: 4, memory }), /Vegetarian/);
  await answer(store, owner, 'My friend wants quiet tonight.', { milestone: 4, memory,
    complete: async messages => { assert.match(messages[0].content!, /Vegetarian/); return { role: 'assistant', content: 'I will use that constraint tonight.' }; },
  });
  assert.equal(saved, 1);
});

test('browser cannot open an unsolicited model-generated URL', async t => {
  const store = setup(t);
  let calls = 0;
  await answer(store, owner, 'Read a menu.', { milestone: 5, browserAvailable: true,
    memory: { list: async () => [], search: async () => [], remember: async () => [], forget: async () => {} },
    complete: async messages => ++calls === 1 ? toolCall('browse_page', { url: 'http://127.0.0.1/private', task: 'Read.' }) :
      (assert.match(messages.at(-1)!.content!, /unavailable/), { role: 'assistant', content: 'Please provide a public URL.' }),
    browse: async () => { assert.fail('Unsolicited URL opened'); },
  });
});

test('conversation persists across a database reopen and reset preserves other owners', t => {
  const store = setup(t);
  store.addTurn(owner, 'user', 'My preference.');
  store.addTurn('someone-else', 'user', 'Another conversation.');
  const reopened = new Store(store.directory);
  assert.equal(reopened.history(owner)[0].content, 'My preference.');
  reopened.reset(owner);
  assert.equal(reopened.history(owner).length, 0);
  assert.equal(reopened.history('someone-else').length, 1);
  reopened.close();
});
