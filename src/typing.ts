import { config } from './config.ts';

// Refresh while composing; serialize stop after any in-flight refresh so a late
// POST cannot turn the bubble back on after the reply finishes.
export async function startTyping(chat: string, request: typeof fetch = fetch): Promise<() => Promise<void>> {
  const url = `https://api.linqapp.com/api/partner/v3/chats/${encodeURIComponent(chat)}/typing`;
  const update = async (method: 'POST' | 'DELETE') => {
    try {
      const response = await request(url, {
        method, headers: { Authorization: `Bearer ${config.linqKey}` },
        signal: AbortSignal.timeout(3000), redirect: 'error',
      });
      if (!response.ok) throw new Error('Typing unavailable');
    } catch { console.error('Typing indicator unavailable; continuing with the reply.'); }
  };
  await update('POST');
  let pending = Promise.resolve();
  const timer = setInterval(() => { pending = pending.then(() => update('POST')); }, 60_000);
  timer.unref();
  let stopping: Promise<void> | undefined;
  return () => {
    clearInterval(timer);
    return stopping ??= pending.then(() => update('DELETE'));
  };
}
