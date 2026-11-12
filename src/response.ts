// Some compatible providers return a model's textual tool syntax instead of
// structured tool_calls. Treat it as a protocol failure, never as an answer.
export function isToolMarkup(text: unknown): boolean {
  return typeof text === 'string' && /<\s*\/?\s*tool_call\b|<\s*function\s*[=>]|<\s*parameter\s*=|<\|tool_call|\[TOOL_CALLS\]/i.test(text);
}

export function textingFormat(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\((https:\/\/[^\s]+)\)/g, '$1: $2')
    .replace(/\*\*([^\n]+?)\*\*/g, '$1')
    .replace(/__([^\n]+?)__/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '\n')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sourceCardLimit(request = ''): number {
  if (/\b(?:no|don't|do not|stop)\b.{0,35}\b(?:more|multiple|several|many|all)\b/i.test(request)) return 1;
  const count = request.match(/\b(\d+|two|three|four|five)\s+(?:different\s+)?(?:sources?|links?|cards?|options?|results?|recommendations?)\b/i)?.[1]?.toLowerCase();
  if (count) return Math.min(3, Math.max(1, ({ two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[count] || Number(count)));
  return /\b(?:more|multiple|several|all|a few)\s+(?:sources?|links?|cards?|options?|results?|recommendations?)\b/i.test(request) ? 3 : 1;
}

export function isVoiceRequest(text = ''): boolean {
  if (/^\/voice(?:\s|$)/i.test(text)) return true;
  if (/^\s*(?:how (?:do|can|to)|explain|what (?:is|are))\b/i.test(text)) return false;
  return /\b(?:send|give|make|record|reply|respond|read|say|speak)\b.{0,60}\b(?:voice notes?|voice memos?|voice messages?|audio messages?|audio repl(?:y|ies)|voice repl(?:y|ies)|out loud|aloud)\b/i.test(text)
    || /^\s*(?:a\s+)?(?:voice note|voice memo|audio reply|voice reply)(?:\s+please)?[.!?]*\s*$/i.test(text);
}

export function messageSummary(text: string): string {
  return textingFormat(text).replace(/https:\/\/[^\s<>"`]+/g, '')
    .replace(/^\s*(?:sources?|references?|links?|menu)\s*:?\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
