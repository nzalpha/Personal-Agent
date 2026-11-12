import { createServer } from 'node:http';
import { incomingJob, verifyWebhook } from './linq.ts';
import type { Store } from './store.ts';
import { whatsappChallenge, whatsappJobs, verifyWhatsAppWebhook } from './whatsapp.ts';

export type WebhookSettings = { channel?: 'linq'; owner: string; line: string; secret: string } |
  { channel: 'whatsapp'; owner: string; phoneNumberId: string; appSecret: string; verifyToken: string };

export function webhookServer(store: Store, settings: WebhookSettings, wake: () => void) {
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && path === '/healthz') { res.end('{"ok":true}'); return; }
    const endpoint = settings.channel === 'whatsapp' ? '/webhooks/whatsapp' : '/webhooks/linq';
    if (settings.channel === 'whatsapp' && req.method === 'GET' && path === endpoint) {
      const challenge = whatsappChallenge(url, settings.verifyToken);
      if (challenge === null) { res.writeHead(403).end('{"error":"verification failed"}'); return; }
      res.setHeader('Content-Type', 'text/plain');
      res.end(challenge); return;
    }
    if (req.method !== 'POST' || path !== endpoint) { res.writeHead(404).end('{"error":"not found"}'); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 256 * 1024) { res.writeHead(413).end('{"error":"body too large"}'); return; }
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks);
      const valid = settings.channel === 'whatsapp' ? verifyWhatsAppWebhook(raw, req.headers, settings.appSecret) : verifyWebhook(raw, req.headers, settings.secret);
      if (!valid) { res.writeHead(401).end('{"error":"invalid signature"}'); return; }
      let jobs;
      try {
        const event = JSON.parse(raw.toString('utf8'));
        if (settings.channel === 'whatsapp') jobs = whatsappJobs(event, settings.owner, settings.phoneNumberId);
        else { const job = incomingJob(event, settings.owner, settings.line); jobs = job ? [job] : []; }
      }
      catch { res.writeHead(400).end('{"error":"invalid event"}'); return; }
      let enqueued = false;
      for (const job of jobs) if (store.enqueue(job)) enqueued = true;
      res.writeHead(200).end('{"ok":true}');
      if (enqueued) wake();
    } catch { if (!res.writableEnded) res.writeHead(500).end('{"error":"retry later"}'); }
  });
}
