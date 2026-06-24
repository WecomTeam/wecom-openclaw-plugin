export type ReplyKind = "block" | "final" | "tool";

export function extractMediaDirectivePayload(rawText: string): {
  text: string;
  mediaUrls: string[];
} {
  const mediaUrls: string[] = [];
  const mediaDirectiveRe = /^MEDIA:\s*`?([^\n`]+?)`?\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = mediaDirectiveRe.exec(rawText)) !== null) {
    const candidate = (match[1] ?? "").trim();
    if (candidate && !mediaUrls.includes(candidate)) {
      mediaUrls.push(candidate);
    }
  }

  const text = mediaUrls.length > 0
    ? rawText.replace(/^MEDIA:\s*`?[^\n`]+?`?\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim()
    : rawText;

  return { text, mediaUrls };
}

function longestOverlapSuffixPrefix(existing: string, next: string): number {
  const max = Math.min(existing.length, next.length);
  for (let size = max; size > 0; size -= 1) {
    if (existing.endsWith(next.slice(0, size))) {
      return size;
    }
  }
  return 0;
}

export function mergeDeliveredText(existing: string, next: string, kind: ReplyKind): string {
  if (!next) {
    return existing;
  }
  if (!existing) {
    return next;
  }
  if (existing === next || existing.endsWith(next)) {
    return existing;
  }
  if (kind === "final" && next.startsWith(existing)) {
    return next;
  }

  const overlap = longestOverlapSuffixPrefix(existing, next);
  return `${existing}${next.slice(overlap)}`;
}
