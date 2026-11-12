import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.ts';
import { acknowledgeMessage } from '../src/extras.ts';
import type { Job } from '../src/store.ts';

test('Jev reactions validate decisions, skip sensitive messages, and fall back on errors', async t => {
  const previous = { reactionMode: config.reactionMode, modelKey: config.modelKey, modelBaseUrl: config.modelBaseUrl };
  Object.assign(config, { reactionMode: 'jev', modelKey: 'fake-key', modelBaseUrl: 'https://openrouter.ai/api/v1' });
  t.after(() => Object.assign(config, previous));
  const job: Job = { id: 'chat:message', event_id: 'event', chat: 'chat', sender: 'owner', text: 'Find sushi nearby', reply: null, attempts: 0, next_at: 0, state: 'pending' };
  for (const scenario of ['valid', 'none', 'unknown', 'http-error', 'timeout'] as const) {
    const sent: string[] = [];
    await acknowledgeMessage(job, async (url, init) => {
      if (String(url) === 'https://openrouter.ai/api/alpha/decisions') {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.state, { message: job.text });
        assert.equal(body.model, 'typesafe/jev-1.14');
        assert.ok(init?.signal);
        if (scenario === 'http-error') return new Response(null, { status: 503 });
        if (scenario === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
        return Response.json({ answers: { reaction: { type: 'choice', choice: scenario === 'valid' ? 'excited' : scenario === 'none' ? 'none' : 'injected-emoji' } } });
      }
      assert.equal(String(url), 'https://api.linqapp.com/api/partner/v3/messages/message/reactions');
      sent.push(JSON.parse(String(init?.body)).custom_emoji);
      return Response.json({});
    });
    assert.deepEqual(sent, scenario === 'none' ? [] : [scenario === 'valid' ? '🤩' : '🍣'], scenario);
  }
});
