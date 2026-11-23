/**
 * Source-provided tags (yt-dlp `info.tags`) stored as suggestions in
 * `videos.auto_tags`, separate from user tags (issue #546).
 */

export const MAX_AUTO_TAGS = 20;
export const MAX_AUTO_TAG_LENGTH = 64;
export const MAX_TAG_ALIASES = 500;

export interface NormalizeSourceTagsOptions {
  /** Global user tag catalog (settings.tags); matches reuse its spelling. */
  catalog?: readonly unknown[];
  /** The video's own user tags; these never repeat as suggestions. */
  manualTags?: readonly unknown[];
  /** settings.tagAliases: lowercase alias → canonical tag. */
  aliases?: Readonly<Record<string, unknown>>;
}

const cleanTag = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim();
};

/** The settings.tagAliases key a tag is looked up by. */
export const tagAliasKey = (value: unknown): string => cleanTag(value).toLowerCase();

/**
 * Turn a raw source tag list into at most MAX_AUTO_TAGS display-ready
 * suggestions: trimmed, without leading `#`, mapped through the user's tag
 * aliases, unique ignoring case, spelled
 * like the catalog when it already has the tag, and without any tag the video
 * already carries.
 */
export function normalizeSourceTags(
  raw: unknown,
  { catalog = [], manualTags = [], aliases = {} }: NormalizeSourceTagsOptions = {}
): string[] {
  if (!Array.isArray(raw)) return [];

  const aliasMap = new Map<string, string>();
  for (const [alias, target] of Object.entries(aliases)) {
    // A target is a tag name, kept as written so it matches the catalog.
    const canonical = typeof target === "string" ? target.trim() : "";
    if (canonical && canonical.length <= MAX_AUTO_TAG_LENGTH) {
      aliasMap.set(tagAliasKey(alias), canonical);
    }
  }

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
    const cleaned = cleanTag(value);
    if (!cleaned || cleaned.length > MAX_AUTO_TAG_LENGTH) continue;
    const tag = aliasMap.get(tagAliasKey(cleaned)) ?? cleaned;
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

/**
 * Validate a client-submitted tag alias map and return it in stored form:
 * keys cleaned like source tags and lowercased, tag names only trimmed (they
 * must keep the catalog's spelling, e.g. "#Music"). Throws with a
 * user-facing message when the map is malformed, too large, maps a tag to
 * itself, or chains (a canonical name that is itself an alias).
 */
export function normalizeTagAliases(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tag aliases must be an object.");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_TAG_ALIASES) {
    throw new Error(`At most ${MAX_TAG_ALIASES} tag aliases are allowed.`);
  }

  // No prototype, so an alias like "__proto__" stays an ordinary key.
  const result: Record<string, string> = Object.create(null);
  for (const [rawAlias, rawTarget] of entries) {
    const alias = tagAliasKey(rawAlias);
    const target = typeof rawTarget === "string" ? rawTarget.trim() : "";
    if (!alias || !target) {
      throw new Error("Tag aliases and their tags cannot be empty.");
    }
    if (alias.length > MAX_AUTO_TAG_LENGTH || target.length > MAX_AUTO_TAG_LENGTH) {
      throw new Error(`Tag aliases and their tags are limited to ${MAX_AUTO_TAG_LENGTH} characters.`);
    }
    // A source tag spelled like the target is looked up by this key.
    if (alias === tagAliasKey(target)) {
      throw new Error(`Tag alias "${alias}" cannot point to itself.`);
    }
    if (Object.prototype.hasOwnProperty.call(result, alias)) {
      throw new Error(`Tag alias "${alias}" is listed twice.`);
    }
    result[alias] = target;
  }
  for (const target of Object.values(result)) {
    if (Object.prototype.hasOwnProperty.call(result, tagAliasKey(target))) {
      throw new Error(`"${target}" is itself an alias, so it cannot be an alias target.`);
    }
  }
  return result;
}
