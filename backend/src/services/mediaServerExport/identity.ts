/**
 * Show identity resolution for the playlist-TV media-server layout (issue #411).
 *
 * A show identity is resolved once and then persisted. Nothing here may be
 * recomputed from a display title during an ordinary rebuild: a channel rename
 * must update `tvshow.nfo`, never move a directory or split a show in two.
 *
 * This module is pure. It performs no database or filesystem access.
 */

/** Quality of the resolved identity, surfaced in logs and job diagnostics. */
export type ShowIdentityQuality =
  | "channel_id"
  | "channel_url"
  | "author_fallback";

export interface ShowIdentityCandidate {
  platform: string;
  sourceChannelId?: string;
  sourceChannelUrl?: string;
  authorName?: string;
}

export interface ResolvedShowIdentity {
  identityKey: string;
  quality: ShowIdentityQuality;
  platform: string;
  sourceChannelId?: string;
  sourceChannelUrl?: string;
}

/**
 * Canonical lowercase platform token. MyTube stores the platform inconsistently
 * ("YouTube" on subscriptions, "youtube" on videos, "Bilibili"/"bilibili" on
 * collections), and an identity key that varied with the casing would split one
 * channel into several shows.
 */
export function normalizePlatform(value: unknown): string {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  if (normalized === "youtube" || normalized === "yt") {
    return "youtube";
  }
  if (normalized === "bilibili" || normalized === "b23" || normalized === "bili") {
    return "bilibili";
  }
  return normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "unknown";
}

/**
 * Reduces a channel URL to a comparable form so that `http` vs `https`,
 * `www.`/`m.` hosts, a trailing slash, tracking query strings, and case
 * differences in the host all resolve to the same show.
 *
 * The path case is preserved: YouTube handles and channel ids are
 * case-sensitive, and lowercasing them would merge distinct channels.
 */
export function normalizeChannelUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }

  const host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const pathname = parsed.pathname.replace(/\/+$/, "");

  // Query and fragment are tracking noise for a channel URL, with one
  // exception: Bilibili space URLs are path-based, so nothing is lost.
  return `${host}${pathname}`;
}

/**
 * Case- and whitespace-insensitive author key. Used only when no channel id or
 * URL exists; it is the weakest identity and is always logged as such.
 */
export function normalizeAuthorIdentity(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return normalized || undefined;
}

/**
 * Resolves an identity key in the precedence order fixed by the design:
 * channel id, then normalized channel URL, then normalized author name.
 *
 * Returns undefined when nothing usable is available — the caller must then
 * skip the item with `unresolved_show_identity` rather than invent an identity.
 */
export function resolveShowIdentity(
  candidate: ShowIdentityCandidate
): ResolvedShowIdentity | undefined {
  const platform = normalizePlatform(candidate.platform);
  const channelId =
    typeof candidate.sourceChannelId === "string" &&
    candidate.sourceChannelId.trim()
      ? candidate.sourceChannelId.trim()
      : undefined;
  const channelUrl = normalizeChannelUrl(candidate.sourceChannelUrl);
  const rawChannelUrl =
    typeof candidate.sourceChannelUrl === "string" &&
    candidate.sourceChannelUrl.trim()
      ? candidate.sourceChannelUrl.trim()
      : undefined;

  if (channelId) {
    return {
      identityKey: `${platform}:channel-id:${channelId}`,
      quality: "channel_id",
      platform,
      sourceChannelId: channelId,
      sourceChannelUrl: rawChannelUrl,
    };
  }

  if (channelUrl) {
    return {
      identityKey: `${platform}:channel-url:${channelUrl}`,
      quality: "channel_url",
      platform,
      sourceChannelUrl: rawChannelUrl,
    };
  }

  const author = normalizeAuthorIdentity(candidate.authorName);
  if (author) {
    return {
      identityKey: `${platform}:author:${author}`,
      quality: "author_fallback",
      platform,
    };
  }

  return undefined;
}

/**
 * Platform token for shows that come from a marked collection rather than a
 * source channel. Deliberately not a real platform: a collection-show is a
 * MyTube-local concept and must never sit in the same identity namespace as a
 * YouTube or Bilibili channel.
 */
export const COLLECTION_SHOW_PLATFORM = "mytube";

/**
 * Identity for a collection exported as its own show.
 *
 * Keyed on the collection id alone — never on the title — so renaming the
 * collection, or two unrelated dramas sharing a name, can never collapse two
 * shows into one.
 */
export function buildCollectionShowIdentityKey(collectionId: string): string {
  return `collection:${collectionId}`;
}

export function isCollectionShowIdentityKey(identityKey: string): boolean {
  return identityKey.startsWith("collection:");
}

/**
 * True when `candidate` is a strictly stronger identity for a show that was
 * created from a weaker one.
 *
 * Only an author-fallback show may be upgraded, and only when it still has no
 * channel id. Two existing shows are never merged automatically: that would
 * silently collapse two media-server libraries, which is not recoverable.
 */
export function canUpgradeShowIdentity(
  existing: { identityKey: string; sourceChannelId?: string },
  candidate: ResolvedShowIdentity
): boolean {
  if (candidate.quality !== "channel_id" || !candidate.sourceChannelId) {
    return false;
  }
  if (existing.sourceChannelId) {
    return false;
  }
  return existing.identityKey.includes(":author:");
}

/** One candidate identity plus whatever the caller wants back for it. */
export interface CompatibleIdentityCandidate<T> {
  identityKey: string;
  platform: string;
  /** Normalized author identity of the show title this candidate would carry. */
  title: string;
  /** True when the identity came from a channel id or URL, not an author name. */
  strong: boolean;
  value: T;
}

/**
 * Collapses author-fallback identities into a stronger identity of the same
 * platform and title, the way findCompatibleExistingShow does when it decides
 * whether a new candidate joins an existing show.
 *
 * Shared so that show allocation, the ambiguity test, and the rebuild scope
 * preview cannot disagree about how many shows a set of videos produces - they
 * did, and the preview overstated its folder count as a result.
 *
 * A weak candidate merges only when exactly one strong candidate matches its
 * title. Two matching strong candidates is genuine ambiguity: the allocator
 * refuses to pick, so neither may the callers.
 */
export function collapseCompatibleIdentities<T>(
  candidates: CompatibleIdentityCandidate<T>[]
): T[] {
  const strongByTitle = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidate.strong || !candidate.title) continue;
    const key = `${candidate.platform}:${candidate.title}`;
    strongByTitle.set(key, (strongByTitle.get(key) ?? 0) + 1);
  }

  return candidates
    .filter((candidate) => {
      if (candidate.strong || !candidate.title) return true;
      return strongByTitle.get(`${candidate.platform}:${candidate.title}`) !== 1;
    })
    .map((candidate) => candidate.value);
}
