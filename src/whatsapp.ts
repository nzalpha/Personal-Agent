import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Job, Store } from './store.ts';
import { DeliveryReviewRequired } from './worker.ts';
import { replyLinks } from './linq.ts';
import { messageSummary, sourceCardLimit } from './response.ts';

export type WhatsAppSettings = {
  owner: string; phoneNumberId: string; accessToken: string; apiVersion: string;
};

export function verifyWhatsAppWebhook(raw: Buffer, headers: IncomingHttpHeaders, appSecret: string): boolean {
  const signature = headers['x-hub-signature-256'];
  if (!appSecret || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', appSecret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export function whatsappChallenge(url: URL, verifyToken: string): string | null {
  const token = Buffer.from(url.searchParams.get('hub.verify_token') || '');
  const expected = Buffer.from(verifyToken);
  if (!expected.length || token.length !== expected.length || !timingSafeEqual(token, expected) ||
      url.searchParams.get('hub.mode') !== 'subscribe') return null;
  return url.searchParams.get('hub.challenge');
}

// IDs are namespaced so a restart with a different channel cannot send old jobs
// through the wrong provider. The owner scope retains its + for shared memory.
export function whatsappJobs(event: unknown, owner: string, phoneNumberId: string): Pick<Job, 'id' | 'event_id' | 'chat' | 'sender' | 'text'>[] {
  if (!event || typeof event !== 'object') throw new Error('Invalid event');
  const envelope = event as Record<string, any>;
  if (envelope.object !== 'whatsapp_business_account') return [];
  if (!Array.isArray(envelope.entry)) throw new Error('Invalid entries');
  if (!/^\+[1-9]\d{7,14}$/.test(owner) || !/^\d+$/.test(phoneNumberId)) throw new Error('Invalid WhatsApp configuration');
  const jobs: Pick<Job, 'id' | 'event_id' | 'chat' | 'sender' | 'text'>[] = [];
  for (const entry of envelope.entry) {
    if (!Array.isArray(entry?.changes)) throw new Error('Invalid changes');
    for (const change of entry.changes) {
      const value = change?.value;
      if (change?.field !== 'messages' || value?.messaging_product !== 'whatsapp' ||
          value?.metadata?.phone_number_id !== phoneNumberId) continue;
      if (value.messages === undefined) continue; // Delivery/read receipts.
      if (!Array.isArray(value.messages)) throw new Error('Invalid messages');
      for (const message of value.messages) {
        if (message?.from !== owner.slice(1) || message?.type !== 'text' || message.group_id || value.group_id) continue;
        if (typeof message.id !== 'string' || !message.id || message.id.length > 200 ||
            typeof message.text?.body !== 'string') throw new Error('Invalid text message');
        const text = message.text.body.trim();
        if (!text) continue;
        const id = `whatsapp:${phoneNumberId}:${message.id}`;
        jobs.push({ id, event_id: id, chat: `whatsapp:${phoneNumberId}:${message.from}`, sender: owner,
          text: text.length > 8000 ? '/too-long' : text });
      }
    }
  }
  return jobs;
}

export function whatsappTextParts(text: string, originalRequest = ''): { body: string; preview_url: boolean }[] {
  const links = replyLinks(text).slice(0, sourceCardLimit(originalRequest));
  const summary = links.length ? messageSummary(text) : text.trim();
  const parts: { body: string; preview_url: boolean }[] = [];
  // Bound each text body to 4096 UTF-16 units without splitting a surrogate pair.
  let body = '';
  for (const char of summary) {
    if (body.length + char.length > 4096) { parts.push({ body, preview_url: false }); body = ''; }
    body += char;
  }
  if (body) parts.push({ body, preview_url: false });
  for (const url of links) parts.push({ body: url, preview_url: true });
  return parts;
}

export async function sendWhatsAppReply(store: Store, settings: WhatsAppSettings, chat: string, text: string,
  key: string, originalRequest = '', request: typeof fetch = fetch): Promise<void> {
  if (!/^v\d+\.0$/.test(settings.apiVersion) || !/^\d+$/.test(settings.phoneNumberId) ||
      !/^\+[1-9]\d{7,14}$/.test(settings.owner) || !settings.accessToken.trim() ||
      chat !== `whatsapp:${settings.phoneNumberId}:${settings.owner.slice(1)}`) {
    throw new DeliveryReviewRequired('Invalid WhatsApp destination or configuration');
  }
  const parts = whatsappTextParts(text, originalRequest);
  if (!parts.length) throw new DeliveryReviewRequired('Empty WhatsApp reply');
  for (const [index, part] of parts.entries()) {
    const partKey = `${key}:${index}`;
    const body = JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual',
      to: settings.owner.slice(1), type: 'text', text: part });
    const hash = createHash('sha256').update(`${settings.phoneNumberId}:${body}`).digest('hex');
    const prior = store.db.prepare('SELECT payload_hash,state FROM whatsapp_outbox WHERE key=?').get(partKey) as
      { payload_hash: string; state: string } | undefined;
    if (prior) {
      if (prior.payload_hash !== hash || prior.state !== 'sent') throw new DeliveryReviewRequired('WhatsApp send requires review');
      continue;
    }
    // Cloud API provides no documented message-send idempotency key. Persist the
    // attempt before sending; a crash, timeout, or rejection is held for review.
    store.db.prepare("INSERT INTO whatsapp_outbox(key,payload_hash,state) VALUES(?,?,'sending')").run(partKey, hash);
    try {
      const response = await request(`https://graph.facebook.com/${settings.apiVersion}/${settings.phoneNumberId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${settings.accessToken}`, 'Content-Type': 'application/json' },
        body, signal: AbortSignal.timeout(30_000), redirect: 'error',
      });
      if (!response.ok) {
        store.db.prepare("UPDATE whatsapp_outbox SET state='rejected' WHERE key=?").run(partKey);
        throw new DeliveryReviewRequired('WhatsApp rejected the reply');
      }
      const result = await response.json() as { messages?: { id?: string }[] };
      if (!result.messages?.[0]?.id) throw new DeliveryReviewRequired('WhatsApp acceptance uncertain');
      store.db.prepare("UPDATE whatsapp_outbox SET state='sent' WHERE key=?").run(partKey);
    } catch {
      throw new DeliveryReviewRequired('WhatsApp delivery requires review');
    }
  }
}
