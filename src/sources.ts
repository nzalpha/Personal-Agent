export function isExaLibraryUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'exa.ai' && url.pathname.startsWith('/library/');
  } catch { return false; }
}
