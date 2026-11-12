import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageTarget, readWithKernel, type KernelBrowserAPI } from '../src/browser.ts';

test('Kernel only accepts named public HTTPS targets', () => {
  for (const value of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://service.local', 'https://x.internal', 'https://user:secret@example.com', 'file:///tmp/test']) {
    assert.throws(() => pageTarget(value));
  }
  assert.equal(pageTarget('https://example.com/menu').hostname, 'example.com');
});

test('Kernel reads fixed code, bounds evidence, and deletes the session', async () => {
  let deleted = false;
  const api: KernelBrowserAPI = {
    create: async body => { assert.deepEqual(body.network.allowed_hosts, ['example.com']); assert.equal(body.timeout_seconds, 60); return { session_id: 'browser-1' }; },
    playwright: { execute: async (id, body) => {
      assert.equal(id, 'browser-1');
      assert.match(body.code, /page\.goto\("https:\/\/example.com\/menu"/);
      assert.doesNotMatch(body.code, /UNTRUSTED_TASK/);
      return { result: { title: 'Menu', url: 'https://example.com/menu', text: 'x'.repeat(20000) } };
    } },
    deleteByID: async (id, options) => { assert.equal(id, 'browser-1'); assert.equal(options.timeout, 10000); deleted = true; },
  };
  const result = await readWithKernel('https://example.com/menu', 'UNTRUSTED_TASK', AbortSignal.timeout(1000), api);
  assert.equal(deleted, true);
  assert.equal(JSON.parse(result.content).text.length, 14000);
  assert.equal(JSON.parse(result.content).question, 'UNTRUSTED_TASK');
});

test('Kernel session is deleted when reading fails or the request is canceled', async () => {
  for (const canceled of [false, true]) {
    const controller = new AbortController();
    let deleted = false;
    const api: KernelBrowserAPI = {
      create: async () => ({ session_id: 'browser-1' }),
      playwright: { execute: async () => { if (canceled) controller.abort(); throw new Error('Read failed'); } },
      deleteByID: async (_id, options) => { assert.equal('signal' in options, false); deleted = true; },
    };
    await assert.rejects(readWithKernel('https://example.com', 'menu', controller.signal, api));
    assert.equal(deleted, true);
  }
});

test('Kernel rejects off-host results and cleans up the session', async () => {
  let deleted = false;
  const api: KernelBrowserAPI = {
    create: async () => ({ session_id: 'browser-1' }),
    playwright: { execute: async () => ({ result: { title: 'Elsewhere', url: 'https://elsewhere.example/menu', text: 'Text.' } }) },
    deleteByID: async () => { deleted = true; },
  };
  await assert.rejects(readWithKernel('https://example.com/menu', 'menu', AbortSignal.timeout(1000), api), /redirected/);
  assert.equal(deleted, true);
});
