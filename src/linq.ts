import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Job } from './store.ts';
import { pageTarget } from './browser.ts';
import { isExaLibraryUrl } from './sources.ts';
import { messageSummary } from './response.ts';

export function verifyWebhook(raw: Buffer, headers: IncomingHttpHeaders, secret: string, now = Date.now()): boolean {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (typeof id !== 'string' || !id || typeof timestamp !== 'string' || !/^\d+$/.test(timestamp) || typeof signatures !== 'string') return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300 || !secret) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  if (key.length < 16) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(raw).digest();
  return signatures.split(/\s+/).some(signature => {
    const [version, encoded] = signature.split(',');
    if (version !== 'v1' || !encoded) return false;
    const actual = Buffer.from(encoded, 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

export function incomingJob(event: unknown, owner: string, line: string): Pick<Job, 'id' | 'event_id' | 'chat' | 'sender' | 'text'> | null {
  if (!event || typeof event !== 'object') throw new Error('Invalid event');
  const e = event as Record<string, any>;
  if (e.webhook_version !== '2026-02-03') throw new Error('Pin webhook version to 2026-02-03');
  if (e.event_type !== 'message.received') return null;
  const d = e.data;
  if (!owner || !line || !d || d.direction !== 'inbound' || d.chat?.is_group !== false || d.sender_handle?.is_me !== false ||
    d.sender_handle?.handle !== owner || d.chat?.owner_handle?.handle !== line || d.chat?.owner_handle?.is_me !== true) return null;
  for (const value of [e.event_id, d.id, d.chat?.id]) {
    if (typeof value !== 'string' || !value || value.length > 200) throw new Error('Invalid message identifiers');
  }
  if (!Array.isArray(d.parts)) throw new Error('Invalid message parts');
  const text = d.parts.filter((p: any) => p?.type === 'text' && typeof p.value === 'string').map((p: any) => p.value).join('\n').trim();
  if (!text) return null;
  if (text.length > 8000) return { id: `${d.chat.id}:${d.id}`, event_id: e.event_id, chat: d.chat.id, sender: owner, text: '/too-long' };
  return { id: `${d.chat.id}:${d.id}`, event_id: e.event_id, chat: d.chat.id, sender: owner, text };
}

export async function sendReply(key: string, chatId: string, text: string, idempotencyKey: string, request: typeof fetch = fetch, cardUrls: readonly string[] = replyLinks(text), maxCards = 1): Promise<void> {
  const links = replyLinks(cardUrls.join('\n')).slice(0, Number.isFinite(maxCards) ? Math.min(3, Math.max(1, Math.floor(maxCards))) : 1);
  const summary = links.length ? messageSummary(text) : text;
  if (summary) await sendPart({ type: 'text', value: summary }, idempotencyKey);
  // Linq requires a link to be the only part in its message. Keep each card's
  // identity stable when the worker retries after a partially successful send.
  for (const url of links) {
    const cardKey = `exa-card-${createHash('sha256').update(JSON.stringify([idempotencyKey, url])).digest('hex')}`;
    await sendPart({ type: 'link', value: url }, cardKey);
  }

  async function sendPart(part: { type: 'text' | 'link'; value: string }, sendKey: string): Promise<void> {
    const response = await request(`https://api.linqapp.com/api/partner/v3/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { parts: [part], idempotency_key: sendKey } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Linq returned HTTP ${response.status}`);
    // Accepted by Linq is not a delivery receipt. Never log the API response or phone number.
  }
}

export function replyLinks(text: string): string[] {
  const links = new Set<string>();
  for (const match of text.matchAll(/https:\/\/[^\s<>"`]+/g)) {
    let value = match[0].replace(/[.,;:!?]+$/, '');
    // Remove prose/Markdown delimiters while preserving balanced URL parentheses.
    for (;;) {
      const pair = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[value.at(-1) || ''];
      const last = value.at(-1)!;
      if (!pair || value.split(last).length <= value.split(pair).length) break;
      value = value.slice(0, -1).replace(/[.,;:!?]+$/, '');
    }
    if (value.length > 2048) continue;
    try {
      const url = pageTarget(value).href;
      if (url.length <= 2048) links.add(url);
    } catch { continue; }
  }
  return [...links].sort((a, b) => Number(isExaLibraryUrl(b)) - Number(isExaLibraryUrl(a))).slice(0, 3);
}
