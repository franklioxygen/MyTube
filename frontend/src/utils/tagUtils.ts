/**
 * Shared tag normalization and usage ranking.
 * Matching is case-insensitive / trim-based; display keeps catalog casing.
 */

export function normalizeTagKey(tag: string | null | undefined): string {
  if (tag == null) return "";
  return String(tag).trim().toLowerCase();
}

/** Count videos that explicitly include each catalog tag (case-insensitive). */
export function countTagUsage(
  availableTags: string[],
  videos: Array<{ tags?: string[] }>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of availableTags) {
    counts.set(tag, 0);
  }

  const catalogByKey = new Map(
    availableTags.map((tag) => [normalizeTagKey(tag), tag])
  );

  for (const video of videos) {
    const seen = new Set<string>();
    for (const raw of video.tags ?? []) {
      const canonical = catalogByKey.get(normalizeTagKey(raw));
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    }
  }
  return counts;
}

/** Most-used first; alphabetical tie-break. Unused catalog tags stay at the end. */
export function sortTagsByUsage(
  availableTags: string[],
  videos: Array<{ tags?: string[] }>
): string[] {
  const counts = countTagUsage(availableTags, videos);
  return [...availableTags].sort((a, b) => {
    const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
}
