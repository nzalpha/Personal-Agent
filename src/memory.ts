import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, modelEndpoint } from './config.ts';
import type { Store } from './store.ts';

export type MemoryRecord = { id: string; memory: string; createdAt?: string; score?: number };
export interface PersonalMemory {
  list(scope: string, signal?: AbortSignal): Promise<MemoryRecord[]>;
  search(scope: string, text: string, signal: AbortSignal): Promise<MemoryRecord[]>;
  remember(scope: string, text: string, signal: AbortSignal): Promise<MemoryRecord[]>;
  forget(scope: string, id?: string, signal?: AbortSignal): Promise<void>;
}
export class MemoryError extends Error {
  constructor() { super('Memory is unavailable. Please try again. Nothing was confirmed as saved or forgotten.'); }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const services = new WeakMap<Store, PersonalMemory>();
export function personalMemory(store: Store): PersonalMemory {
  let memory = services.get(store);
  if (!memory) { memory = new Mem0Memory(store); services.set(store, memory); }
  return memory;
}

// One short-lived worker per operation keeps Mem0's native handles, SDK logs,
// credentials and network timeouts separate from the chat server.
export class Mem0Memory implements PersonalMemory {
  store: Store;
  private queues = new Map<string, Promise<unknown>>();
  constructor(store: Store) { this.store = store; }
  private directory(scope: string) { return join(this.store.directory, 'mem0', digest(scope)); }
  private async serial<T>(scope: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(scope) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.queues.set(scope, next);
    try { return await next; } finally { if (this.queues.get(scope) === next) this.queues.delete(scope); }
  }
  private legacy(scope: string): MemoryRecord[] {
    return this.store.memories(scope).map(memory => ({ id: `legacy-${digest(memory)}`, memory }));
  }
  async list(scope: string, signal?: AbortSignal): Promise<MemoryRecord[]> {
    return this.serial(scope, async () => {
      const saved = existsSync(this.directory(scope)) ? await this.run(scope, 'list', '', signal) : [];
      return [...this.legacy(scope).filter(old => !saved.some(item => item.memory === old.memory)), ...saved];
    });
  }
  async search(scope: string, text: string, signal: AbortSignal): Promise<MemoryRecord[]> {
    return this.serial(scope, async () => {
      if (!existsSync(this.directory(scope)) && !this.store.memories(scope).length) return [];
      return this.run(scope, 'search', text, signal, true);
    });
  }
  async remember(scope: string, text: string, signal: AbortSignal): Promise<MemoryRecord[]> {
    return this.serial(scope, () => this.run(scope, 'add', text, signal, true));
  }
  async forget(scope: string, id?: string, signal?: AbortSignal): Promise<void> {
    return this.serial(scope, async () => {
      signal?.throwIfAborted();
      if (id === undefined) {
        // The worker has exited before this queue advances; remove this owner's
        // vectors, entity index and SDK metadata together, leaving other scopes intact.
        rmSync(this.directory(scope), { recursive: true, force: true });
        this.store.forget(scope); this.store.reset(scope); return;
      }
      if (!id.trim() || id.length > 100) throw new MemoryError();
      const old = this.legacy(scope).find(item => item.id === id);
      if (old) this.store.forgetOne(scope, old.memory);
      else {
        const record = (await this.run(scope, 'list', '', signal)).find(item => item.id === id);
        if (!record) throw new MemoryError();
        await this.run(scope, 'delete', id, signal);
        // A failed earlier migration may have left an original and its copy.
        this.store.forgetOne(scope, record.memory);
      }
      // Remove old chat context so a forgotten fact cannot be reconstructed from it.
      this.store.reset(scope);
    });
  }
  private async run(scope: string, action: string, text: string, signal?: AbortSignal, migrate = false): Promise<MemoryRecord[]> {
    signal?.throwIfAborted();
    if (text.length > 8000 || !Number.isInteger(config.memoryDimensions) || config.memoryDimensions < 1 || config.memoryDimensions > 8192) throw new MemoryError();
    modelEndpoint(); modelEndpoint(config.memoryEmbeddingBaseUrl);
    const directory = this.directory(scope);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const imports = migrate ? this.store.memories(scope) : [];
    const result = await new Promise<MemoryRecord[]>((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./memory-worker.ts', import.meta.url))], {
        cwd: directory,
        env: { PATH: process.env.PATH || '', MEM0_DIR: directory, MEM0_TELEMETRY: 'false', NODE_NO_WARNINGS: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = ''; let failed = false;
      const abort = () => { failed = true; child.kill('SIGKILL'); };
      const timer = setTimeout(abort, 40_000);
      signal?.addEventListener('abort', abort, { once: true });
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      child.stdout.on('data', chunk => { output += String(chunk); if (output.length > 200_000) abort(); });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', () => { cleanup(); reject(new MemoryError()); });
      child.on('close', code => {
        cleanup();
        if (failed || code !== 0) { reject(new MemoryError()); return; }
        try {
          const data = JSON.parse(output) as { records?: MemoryRecord[] };
          if (!Array.isArray(data.records) || data.records.length > 200 || data.records.some(item =>
            !item || typeof item.id !== 'string' || typeof item.memory !== 'string' || item.memory.length > 1000)) throw new Error();
          resolve(data.records);
        } catch { reject(new MemoryError()); }
      });
      if (signal?.aborted) abort();
      child.stdin.end(JSON.stringify({ action, text, imports, directory, scope: digest(scope),
        model: config.model, modelKey: config.modelKey, modelBaseUrl: config.modelBaseUrl,
        embeddingModel: config.memoryEmbeddingModel, embeddingKey: config.memoryEmbeddingKey || config.modelKey,
        embeddingBaseUrl: config.memoryEmbeddingBaseUrl, dimensions: config.memoryDimensions, timezone: config.timezone }));
    });
    // Only retire legacy preferences after a verified import, never on failure.
    if (imports.length) for (const value of imports) this.store.forgetOne(scope, value);
    return result;
  }
}
