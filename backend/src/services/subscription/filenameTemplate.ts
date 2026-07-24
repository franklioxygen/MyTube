import { ValidationError } from "../../errors/DownloadErrors";
import { validateTemplate } from "../filenameTemplate/validators";

/**
 * Validate and normalize a raw filename-template override value from a request
 * body. Accepts a string or null; treats empty/whitespace as "cleared" (null),
 * which means "inherit the current global filename naming settings". Throws
 * ValidationError on wrong type or an invalid/unsafe template.
 *
 * The existing global template validator owns the 2,000-character limit, the
 * path-traversal rules, the required extension placeholder, and the supported
 * variables; this helper does not duplicate those constants.
 *
 * @param sourceCollectionType Optional source-collection type used only to
 *   shape non-blocking warnings. It is not required to reject a save. Use
 *   "playlist" for playlist subscriptions and channel-playlists watchers (the
 *   watcher copies its template to child playlists), and "channel" for channel
 *   and Twitch subscriptions.
 */
export function normalizeSubscriptionFilenameTemplate(
  raw: unknown,
  sourceCollectionType?: "channel" | "playlist" | "single" | "unknown"
): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    throw new ValidationError(
      "filenameTemplate must be a string or null",
      "filenameTemplate"
    );
  }

  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  const result = validateTemplate(normalized, sourceCollectionType);
  if (!result.valid) {
    throw new ValidationError(
      `Invalid filename template: ${result.errors.join("; ")}`,
      "filenameTemplate"
    );
  }
  return normalized;
}
