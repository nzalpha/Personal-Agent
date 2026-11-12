import { createInterface } from 'node:readline/promises';
import { answer } from './agent.ts';
import { IntegrationIncomplete } from './integrations.ts';
import { assertReady, config } from '../src/config.ts';
import { Store } from '../src/store.ts';

try { assertReady(); } catch (error) { console.error((error as Error).message); process.exit(1); }
const store = new Store(config.dataDir);
const scope = config.owner || 'local-owner';
async function chat(text: string) {
  if (!text.trim()) return;
  try {
    const reply = await answer(store, scope, text);
    store.addTurn(scope, 'user', text);
    store.addTurn(scope, 'assistant', reply);
    console.log(`\nAgent: ${reply}\n`);
  } catch (error) {
    console.error(error instanceof IntegrationIncomplete ? error.message : 'Request failed. Check your integration and provider access.');
    process.exitCode = 1;
  }
}
try {
  const prompt = process.argv.slice(2).join(' ');
  if (prompt) await chat(prompt);
  else {
    console.log('Workshop starter · local chat · /help for commands · /exit to quit');
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (;;) {
        const line = await terminal.question('You: ');
        if (line.trim() === '/exit') break;
        await chat(line);
      }
    } finally { terminal.close(); }
  }
} finally { store.close(); }
