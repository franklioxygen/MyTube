/**
 * Source-provided tags (yt-dlp `info.tags`) stored as suggestions in
 * `videos.auto_tags`, separate from user tags (issue #546).
 */

export const MAX_AUTO_TAGS = 20;
export const MAX_AUTO_TAG_LENGTH = 64;

export interface NormalizeSourceTagsOptions {
  /** Global user tag catalog (settings.tags); matches reuse its spelling. */
  catalog?: readonly unknown[];
  /** The video's own user tags; these never repeat as suggestions. */
  manualTags?: readonly unknown[];
}

const cleanTag = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim();
};

/**
 * Turn a raw source tag list into at most MAX_AUTO_TAGS display-ready
 * suggestions: trimmed, without leading `#`, unique ignoring case, spelled
 * like the catalog when it already has the tag, and without any tag the video
 * already carries.
 */
export function normalizeSourceTags(
  raw: unknown,
  { catalog = [], manualTags = [] }: NormalizeSourceTagsOptions = {}
): string[] {
  if (!Array.isArray(raw)) return [];

  const canonical = new Map<string, string>();
  for (const tag of catalog) {
    if (typeof tag === "string" && !canonical.has(tag.toLowerCase())) {
      canonical.set(tag.toLowerCase(), tag);
    }
  }
  const seen = new Set<string>();
  for (const tag of manualTags) {
    if (typeof tag === "string") seen.add(tag.trim().toLowerCase());
  }

  const result: string[] = [];
  for (const value of raw) {
    const tag = cleanTag(value);
    if (!tag || tag.length > MAX_AUTO_TAG_LENGTH) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Lowercasing can lengthen a string ("İ" → "i̇"), so a catalog match is
    // not guaranteed to fit the limit the write path enforces.
    const spelled = canonical.get(key);
    result.push(spelled && spelled.length <= MAX_AUTO_TAG_LENGTH ? spelled : tag);
    if (result.length >= MAX_AUTO_TAGS) break;
  }
  return result;
}

/** Write-path check for client-submitted autoTags (PUT /videos/:id). */
export function isValidAutoTagList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_AUTO_TAGS &&
    value.every(
      (tag) =>
        typeof tag === "string" &&
        tag.trim().length > 0 &&
        tag.length <= MAX_AUTO_TAG_LENGTH
    )
  );
}
