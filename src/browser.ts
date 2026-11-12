import Kernel from '@onkernel/sdk';
import { isIP } from 'node:net';
import { config } from './config.ts';

export type BrowserResult = { content: string; urls: string[]; completed: boolean };
export type Browse = (url: string, task: string, signal: AbortSignal) => Promise<BrowserResult>;
export function browserReady(): boolean { return config.browserEnabled && Boolean(config.kernelKey.trim()); }

export interface KernelBrowserAPI {
  create(body: { timeout_seconds: number; network: { allowed_hosts: string[] } }, options: { signal: AbortSignal; timeout: number }): Promise<{ session_id: string }>;
  playwright: { execute(id: string, body: { code: string }, options: { signal: AbortSignal; timeout: number }): Promise<{ result?: unknown }> };
  deleteByID(id: string, options: { timeout: number }): Promise<unknown>;
}

export function pageTarget(value: string): URL {
  const url = new URL(value);
  // This teaching tool reads named public HTTPS sites, with no local-network URLs.
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    isIP(url.hostname) || url.hostname.includes(':') || !url.hostname.includes('.') ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)) {
    throw new Error('Use a public HTTPS page with a domain name.');
  }
  return url;
}

export async function readWithKernel(url: string, task: string, signal: AbortSignal, api: KernelBrowserAPI): Promise<BrowserResult> {
  const target = pageTarget(url);
  signal.throwIfAborted();
  const options = { signal, timeout: 45_000 };
  const session = await api.create({ timeout_seconds: 60, network: { allowed_hosts: [target.hostname] } }, options);
  try {
    // Fixed read-only Playwright. Model/user text is never executable browser code.
    // Kernel runs this in its browser VM; there is no local Chromium installation.
    const response = await api.playwright.execute(session.session_id, { code: `
      await page.goto(${JSON.stringify(target.href)}, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.locator('body').waitFor({ timeout: 10000 });
      return {
        title: await page.title(),
        url: page.url(),
        text: (await page.locator('body').innerText({ timeout: 10000 })).slice(0, 14000)
      };
    ` }, options);
    const result = response.result as { title?: unknown; url?: unknown; text?: unknown } | null;
    if (!result || typeof result.url !== 'string' || typeof result.text !== 'string' || !result.text.trim()) throw new Error('Kernel returned no readable page.');
    if (pageTarget(result.url).hostname !== target.hostname) throw new Error('Page redirected outside the requested host.');
    return { content: JSON.stringify({ title: String(result.title || '').slice(0, 200), url: result.url,
      question: task.slice(0, 1500), text: result.text.slice(0, 14000), retrievedAt: new Date().toISOString() }), urls: [result.url], completed: true };
  } finally {
    // Cleanup gets its own timeout, so cancellation never skips deleting the session.
    // The 60-second session timeout also bounds abandoned browser lifetime.
    try { await api.deleteByID(session.session_id, { timeout: 10_000 }); }
    catch { console.error('Kernel browser cleanup failed; session will expire after inactivity timeout.'); }
  }
}

export const browse: Browse = async (url, task, signal) => {
  if (!browserReady()) throw new Error('Set KERNEL_API_KEY and WORKSHOP_MILESTONE=3 to inspect pages.');
  const kernel = new Kernel({ apiKey: config.kernelKey, maxRetries: 0 });
  return readWithKernel(url, task, signal, kernel.browsers);
};
