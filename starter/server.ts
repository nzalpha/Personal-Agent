import { answer } from './agent.ts';
import { assertReady, config } from '../src/config.ts';
import { webhookServer } from '../src/http.ts';
import { deliverReply } from './integrations.ts';
import { acknowledgeMessage } from './extras.ts';
import { startTyping } from '../src/typing.ts';
import { Store } from '../src/store.ts';
import { Worker } from '../src/worker.ts';

try {
  if (config.messagingChannel !== 'linq') throw new Error('The starter messaging exercise uses Linq. For WhatsApp, use npm run solution:phone and docs/WHATSAPP.md.');
  assertReady(true);
} catch (error) { console.error((error as Error).message); process.exit(1); }
const store = new Store(config.dataDir);
// Order per message: emoji reaction -> typing bubble (refreshed every 60s, cleared in the
// Worker's finally) -> reply. Reaction and typing failures never block the reply.
const worker = new Worker(store, (scope, text) => answer(store, scope, text), deliverReply,
  job => acknowledgeMessage(job), 'linq', chat => startTyping(chat));
const wake = () => { void worker.tick().catch(() => console.error('Worker storage error.')); };
const server = webhookServer(store, { owner: config.owner, line: config.line, secret: config.webhookSecret }, wake);
const timer = setInterval(wake, 1000);
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.on('error', () => { console.error('Could not start webhook server. Check PORT.'); process.exitCode = 1; clearInterval(timer); store.close(); });
server.listen(config.port, '127.0.0.1', () => { console.log(`Starter Linq webhook ready on http://127.0.0.1:${config.port}/webhooks/linq`); wake(); });
function stop() {
  clearInterval(timer);
  server.close();
  const wait = setInterval(() => {
    if (!worker.busy) { clearInterval(wait); store.close(); }
  }, 100);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
