// This is the attendee's exercise file. Work through TODOs 1–5 in order.
// Transport, persistence, validation, and the bounded agent loop are supplied.
// Complete provider adapters live in ../src/ for reference.
import { config } from '../src/config.ts';
import { sendReply } from '../src/linq.ts';
import { sourceCardLimit } from '../src/response.ts';
import { isExaLibraryUrl } from '../src/sources.ts';
import { complete } from '../src/model.ts';
import type { Complete } from '../src/model.ts';
import { browse as browseWithKernel, pageTarget } from '../src/browser.ts';
import type { Browse } from '../src/browser.ts';
import { personalMemory } from '../src/memory.ts';
import type { PersonalMemory } from '../src/memory.ts';
import type { Store } from '../src/store.ts';
import type { Send } from '../src/worker.ts';

export class IntegrationIncomplete extends Error {
  constructor(step: number, component: string) {
    super(`TODO ${step}: connect ${component} in starter/integrations.ts. See docs/WORKSHOP.md.`);
  }
}

export const callModel: Complete = async (messages, tools, signal) => {
  // TODO 1 — MODEL
  // Forward messages, tools, and the abort signal to the supplied transport;
  // it returns the assistant message (content and/or tool_calls).
  return complete(messages, tools, signal);
};

export async function searchWeb(query: string, signal: AbortSignal): Promise<unknown> {
  // TODO 2 — EXA
  // POST https://api.exa.ai/search (docs: https://exa.ai/docs/search/highlights).
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': config.exaKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, type: 'auto', numResults: 5, contents: { highlights: true } }),
    // Abort with the caller, and never wait more than 20s for Exa.
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    redirect: 'error',
  });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('Search unavailable.'); }
  const data = await response.json() as { results?: { title?: string; url?: string; highlights?: string[] }[] };
  if (!Array.isArray(data.results)) throw new Error('Invalid search result.');
  // Bound the evidence handed to the model: 5 results, 3 highlights each, capped lengths.
  // Keep each URL and stamp the retrieval time so the model can cite and date its sources.
  return {
    retrievedAt: new Date().toISOString(),
    results: data.results.slice(0, 5).map(item => ({
      title: String(item.title || '').slice(0, 200),
      url: String(item.url || '').slice(0, 2048),
      highlights: (Array.isArray(item.highlights) ? item.highlights : [])
        .filter((x): x is string => typeof x === 'string').slice(0, 3).map(x => x.slice(0, 1200)),
    })),
  };
}

export const readPage: Browse = async (url, question, signal) => {
  // TODO 3 — KERNEL
  // Forward URL, question, and signal unchanged. browse() owns the lifecycle:
  // pageTarget() URL validation → create (allow-listed host) → fixed read-only
  // Playwright execute → deleteByID in a finally block, even on abort or error.
  return browseWithKernel(url, question, signal);
};

export function connectMemory(store: Store): PersonalMemory {
  // TODO 4 — MEM0
  // personalMemory(store) caches one adapter per Store. Its list/search/remember/forget
  // methods take the owner scope as an argument, so each owner keeps a separate
  // Mem0 directory under the store's data dir, and writes happen only when the
  // agent's memory tools run for an explicit request.
  return personalMemory(store);
}

export const deliverReply: Send = async (chat, text, idempotencyKey, request) => {
  // TODO 5 — LINQ, with TODO 6 cards.
  // Forward the original chat, reply, and stable idempotency key (so retries never
  // double-send). sourceCards(text) picks the card URLs; sourceCardLimit(request) allows
  // more than the default one card only when the owner explicitly asked for several.
  return sendReply(config.linqKey, chat, text, idempotencyKey, fetch, sourceCards(text), sourceCardLimit(request));
};

export function sourceCards(text: string): string[] {
  // TODO 6 — FEATURE: source preview cards.
  // Up to three distinct public HTTPS URLs from the reply, Exa Library URLs first.
  const links = new Set<string>();
  for (const match of text.matchAll(/https:\/\/[^\s<>"`]+/g)) {
    // Strip trailing prose punctuation, then unbalanced closing delimiters such as the
    // ")" of "(see https://x.com/a)", while keeping balanced ones like /wiki/Foo_(bar).
    let value = match[0].replace(/[.,;:!?]+$/, '');
    for (;;) {
      const closer = value.at(-1) ?? '';
      const opener = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[closer];
      if (!opener || value.split(closer).length <= value.split(opener).length) break;
      value = value.slice(0, -1).replace(/[.,;:!?]+$/, '');
    }
    try {
      const href = pageTarget(value).href; // public HTTPS domain only: no IPs, localhost, ports, credentials
      if (href.length <= 2048) links.add(href);
    } catch { /* not a public page URL: skip */ }
  }
  return [...links].sort((a, b) => Number(isExaLibraryUrl(b)) - Number(isExaLibraryUrl(a))).slice(0, 3);
}
