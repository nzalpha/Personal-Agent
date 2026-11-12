import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answer } from '../src/agent.ts';
import { Store } from '../src/store.ts';
import type { PersonalMemory } from '../src/memory.ts';
import type { ChatMessage } from '../src/model.ts';

const call = (name: string, args = {}): ChatMessage => ({ role: 'assistant', content: null,
  tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aie-memory-tools-'));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}
const empty: PersonalMemory = { search: async () => [], list: async () => [], remember: async () => [], forget: async () => {} };

test('natural save and list tools use authenticated owner scope and return provider evidence', async t => {
  const store = fixture(t); let round = 0;
  const memory: PersonalMemory = { ...empty,
    remember: async (scope, fact) => { assert.equal(scope, 'owner'); assert.equal(fact, 'I am vegetarian'); return [{ id: 'v', memory: fact }]; },
    list: async scope => { assert.equal(scope, 'owner'); return [{ id: 'v', memory: 'I am vegetarian' }]; },
  };
  const reply = await answer(store, 'owner', 'Remember I am vegetarian and show my preferences.', { milestone: 4, memory,
    complete: async messages => {
      if (++round === 1) return call('remember_preference', { fact: 'I am vegetarian', scope: 'someone-else' });
      if (round === 2) { assert.equal(JSON.parse(messages.at(-1)!.content!).saved, true); return call('list_memories'); }
      assert.equal(JSON.parse(messages.at(-1)!.content!).memories[0].id, 'v');
      return { role: 'assistant', content: 'Saved your vegetarian preference.' };
    },
  });
  assert.match(reply, /Saved/);
});

test('selective forgetting requires a listed ID and ends without exposing the old context again', async t => {
  const store = fixture(t); let round = 0; const removed: string[] = [];
  const memory: PersonalMemory = { ...empty,
    list: async () => [{ id: 'v', memory: 'Vegetarian' }, { id: 'c', memory: 'Likes coffee' }],
    forget: async (scope, id) => { assert.equal(scope, 'owner'); removed.push(id!); store.reset(scope); },
  };
  store.addTurn('owner', 'user', 'Old private detail');
  const reply = await answer(store, 'owner', 'Forget my vegetarian preference', { milestone: 4, memory,
    complete: async messages => {
      if (++round === 1) return call('forget_memory', { target: 'one', memory_id: 'invented' });
      if (round === 2) { assert.match(messages.at(-1)!.content!, /Nothing was deleted/); return call('list_memories'); }
      if (round === 3) return call('forget_memory', { target: 'one', memory_id: 'v' });
      assert.fail('Old context was sent to model after forgetting');
    },
  });
  assert.deepEqual(removed, ['v']); assert.match(reply, /other saved preferences remain/);
  assert.equal(store.history('owner').length, 0);
  // Delivery may be retried after a restart. Do not reintroduce the forgotten
  // detail through the original user message when recording the completed turn.
  const reopened = new Store(store.directory);
  reopened.addTurn('owner', 'user', 'Forget my vegetarian preference');
  assert.doesNotMatch(reopened.history('owner')[0].content, /vegetarian/);
  reopened.close();
});

test('reset and forget-all work even if recall fails and never touch another owner', async t => {
  const store = fixture(t);
  for (const name of ['reset_conversation', 'forget_memory']) {
    store.addTurn('owner', 'user', 'Old message'); store.addTurn('other', 'user', 'Keep me');
    let forgot = false;
    const memory: PersonalMemory = { ...empty, search: async () => { throw new Error('Recall offline'); },
      forget: async (scope, id) => { assert.equal(scope, 'owner'); assert.equal(id, undefined); forgot = true; store.reset(scope); } };
    await answer(store, 'owner', name === 'reset_conversation' ? 'Start a fresh conversation' : 'Forget all my saved preferences', {
      milestone: 4, memory, complete: async () => call(name, name === 'forget_memory' ? { target: 'all' } : {}),
    });
    assert.equal(forgot, name === 'forget_memory'); assert.equal(store.history('owner').length, 0);
    assert.ok(store.history('other').length > 0);
  }
});

test('memory errors and disabled tools never report a successful mutation', async t => {
  const store = fixture(t);
  for (const milestone of [3, 4]) {
    let round = 0; let writes = 0;
    await answer(store, 'owner', 'Remember my preference', { milestone,
      memory: { ...empty, remember: async () => { writes++; throw new Error('Provider failed'); } },
      complete: async messages => ++round === 1 ? call('remember_preference', { fact: 'Vegetarian' }) :
        (assert.match(messages.at(-1)!.content!, /Do not claim success/), { role: 'assistant', content: 'I could not confirm that was saved.' }),
    });
    assert.equal(writes, milestone === 4 ? 1 : 0);
  }
});

test('a request to forget one preference cannot use the delete-all path', async t => {
  const store = fixture(t); let round = 0;
  const reply = await answer(store, 'owner', 'Forget my vegetarian preference.', { milestone: 4,
    memory: { ...empty, forget: async () => assert.fail('Deleted more than requested') },
    complete: async messages => ++round === 1 ? call('forget_memory', { target: 'all' }) :
      (assert.match(messages.at(-1)!.content!, /did not explicitly ask to delete all/), { role: 'assistant', content: 'I need to identify that specific preference.' }),
  });
  assert.match(reply, /specific preference/);
});
