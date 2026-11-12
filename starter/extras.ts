// Optional extensions for the longer workshop. These are not wired into the
// running agent; complete and connect each exercise deliberately.
import { config } from '../src/config.ts';
import { queryEmoji } from '../src/extras.ts';
import { jevReaction } from '../src/reactions.ts';
import type { Job } from '../src/store.ts';

const linqBase = 'https://api.linqapp.com/api/partner/v3';

export async function acknowledgeMessage(job: Job, request: typeof fetch = fetch): Promise<void> {
  // TODO 7: react to the inbound message with an emoji. The Worker awaits this first,
  // then starts the typing bubble (starter/server.ts), then sends the reply.
  // The Worker's job id is "<chatId>:<messageId>". Never use event_id for reactions.
  const messageId = job.id.slice(job.chat.length + 1);
  if (!messageId || !job.id.startsWith(`${job.chat}:`)) throw new Error('Missing inbound message ID');
  // Local keyword matching is the default and the fallback when Jev is slow or down.
  let emoji: string | null = queryEmoji(job.text);
  if (config.reactionMode === 'jev') {
    // jevReaction() asks OpenRouter Decisions to pick from a fixed allowlist (or "none"),
    // validates the answer, and times out after 2 seconds.
    try { emoji = await jevReaction(job.text, request); }
    catch { console.error('Jev reaction unavailable; using local emoji.'); }
  }
  if (emoji === null) return; // "none": sensitive message or a request to avoid emojis
  const response = await request(`${linqBase}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.linqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'add', type: 'custom', custom_emoji: emoji }),
    signal: AbortSignal.timeout(3000), // bounded; the Worker treats failure as best effort
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Reaction HTTP ${response.status}`);
}

export async function synthesizeSpeech(_text: string, _signal: AbortSignal): Promise<Uint8Array> {
  // TODO 8: OpenRouter /audio/speech, model mistralai/voxtral-mini-tts-2603,
  // voice en_paul_neutral, response_format mp3. Return validated audio bytes.
  // Then add /voice routing, local file persistence, Linq upload, and voice-memo
  // delivery. Save audio/attachment identity for retries; keep normal replies.
  throw new Error('TODO 8: implement speech generation. See docs/WORKSHOP.md.');
}
