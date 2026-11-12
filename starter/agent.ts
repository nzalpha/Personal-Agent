// Supplied orchestration: learners connect the providers in integrations.ts.
// Every provider is injected explicitly; no TODO silently uses the solution.
import { answer as runAgent } from '../src/agent.ts';
import type { Store } from '../src/store.ts';
import type { PersonalMemory } from '../src/memory.ts';
import { callModel, searchWeb, readPage, connectMemory } from './integrations.ts';

export function answer(store: Store, owner: string, text: string): Promise<string> {
  // Lazy memory wiring lets milestones 1–3 run before the Mem0 exercise.
  const memory: PersonalMemory = {
    list: (scope, signal) => connectMemory(store).list(scope, signal),
    search: (scope, query, signal) => connectMemory(store).search(scope, query, signal),
    remember: (scope, fact, signal) => connectMemory(store).remember(scope, fact, signal),
    forget: (scope, id, signal) => connectMemory(store).forget(scope, id, signal),
  };
  return runAgent(store, owner, text, { complete: callModel, search: searchWeb, browse: readPage, memory });
}
