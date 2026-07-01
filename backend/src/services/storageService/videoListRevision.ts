import crypto from "crypto";

// In-process revision counter for the videos library, used by the list
// endpoint to answer conditional requests (If-None-Match -> 304) without
// hydrating and serializing the whole table. Single process by design
// (better-sqlite3), so an in-memory counter is authoritative.
//
// The boot id makes tags from a previous process unmatchable: without it, a
// restarted server counting up from 0 could reissue a revision number a client
// still holds for different data.
//
// IMPORTANT: every *runtime* write path to the `videos` table must call
// bumpVideosListRevision(). Current bump sites: videoMutations (save/upsert/
// update), videoDeletion, tagService (rename/delete tags), metadataService
// (duration backfill), filenameTemplate/renameJobService, and
// legacyFilenames (formatLegacyFilenames). Startup-only migrations don't need
// a bump — they run before the first request in a fresh process.
const bootId = crypto.randomBytes(4).toString("hex");
let revision = 0;

export function bumpVideosListRevision(): void {
  revision += 1;
}

/**
 * Weak ETag for the current videos list as seen by the given caller scope.
 * The visitor list is visibility-filtered, so it gets its own tag namespace.
 */
export function getVideosListETag(scope: "all" | "visitor"): string {
  return `W/"videos-${scope}-${bootId}-${revision}"`;
}
