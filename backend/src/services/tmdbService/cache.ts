import { mapLanguageToTMDB } from "./constants";
import { hashTMDBCredential } from "./credentials";
import type { CacheEntry, MultiStrategySearchResult, ParsedFilename } from "./types";

export const tmdbSearchCache = new Map<
  string,
  CacheEntry<MultiStrategySearchResult>
>();
export const tmdbSearchInFlight = new Map<
  string,
  Promise<MultiStrategySearchResult>
>();

export const getCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | undefined => {
  const cached = cache.get(key);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return cached.value;
};

export const setCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number
): void => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  if (cache.size <= maxEntries) {
    return;
  }

  const oldestKey = cache.keys().next().value;
  if (oldestKey) {
    cache.delete(oldestKey);
  }
};

export const buildSearchCacheKey = (
  parsed: ParsedFilename,
  credential: string,
  language?: string
): string => {
  const normalizedTitles = parsed.titles
    .map((title) => title.trim().toLowerCase())
    .sort();

  return JSON.stringify({
    titles: normalizedTitles,
    year: parsed.year ?? null,
    season: parsed.season ?? null,
    episode: parsed.episode ?? null,
    isTVShow: parsed.isTVShow,
    language: mapLanguageToTMDB(language),
    credentialHash: hashTMDBCredential(credential),
  });
};
