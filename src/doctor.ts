import { assertReady, config } from './config.ts';
import { browserReady } from './browser.ts';
try {
  assertReady(config.milestone >= 5);
  if (config.milestone >= 3 && !browserReady()) throw new Error('Set KERNEL_API_KEY for milestone 3 and later.');
  console.log(`Configuration valid for milestone ${config.milestone}. This check makes no network calls.`);
  if (config.milestone >= 5) console.log(`Messaging channel: ${config.messagingChannel}. Run npm run solution:phone and send a message from your owner number to verify delivery. See docs/${config.messagingChannel === 'whatsapp' ? 'WHATSAPP' : 'LINQ'}.md.`);
  else console.log('Use npm run starter:chat after completing each TODO, or solution:chat for the instructor version.');
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
