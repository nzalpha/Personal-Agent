import { createHash } from 'node:crypto';
import type { Store, Job } from './store.ts';

export type Generate = (scope: string, text: string) => Promise<string>;
export type Send = (chat: string, text: string, idempotencyKey: string, request?: string) => Promise<void>;
export type Typing = (chat: string) => Promise<() => Promise<void>>;
export class DeliveryReviewRequired extends Error {}

export class Worker {
  busy = false;
  store: Store;
  generate: Generate;
  send: Send;
  acknowledge?: (job: Job) => Promise<void>;
  channel?: 'linq' | 'whatsapp';
  typing?: Typing;
  constructor(store: Store, generate: Generate, send: Send, acknowledge?: (job: Job) => Promise<void>, channel?: 'linq' | 'whatsapp', typing?: Typing) {
    this.store = store; this.generate = generate; this.send = send; this.acknowledge = acknowledge;
    this.channel = channel;
    this.typing = typing;
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      let job;
      while ((job = this.store.next(now, this.channel))) {
        let stopTyping: (() => Promise<void>) | undefined;
        try {
          if (!job.reply && job.attempts === 0) {
            try { await this.acknowledge?.(job); }
            catch { console.error('Reaction unavailable; continuing with the answer.'); }
          }
          try { stopTyping = await this.typing?.(job.chat); }
          catch { console.error('Typing indicator unavailable; continuing with the reply.'); }
          const reply = job.reply ?? await this.generate(job.sender, job.text);
          this.store.saveReply(job.id, reply);
          const key = `exa-${createHash('sha256').update(job.id).digest('hex')}`;
          await this.send(job.chat, reply, key, job.text);
          this.store.finish(job, reply);
        } catch (error) {
          if (error instanceof DeliveryReviewRequired) {
            this.store.hold(job.id);
            console.error('WhatsApp delivery requires review; automatic resend disabled. See docs/WHATSAPP.md.');
            continue;
          }
          // No provider payloads, message contents, phone numbers, or credentials in logs.
          this.store.retry(job.id, job.attempts + 1, 'Generation or delivery failed');
          console.error('Reply attempt failed. Run npm run doctor to check configuration.');
          break;
        } finally {
          try { await stopTyping?.(); }
          catch { console.error('Could not clear typing indicator.'); }
        }
      }
    } finally { this.busy = false; }
  }
}
