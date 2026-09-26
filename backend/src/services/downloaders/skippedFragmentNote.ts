import type { IncompleteDownloadNote } from "../storageService/types";

/** yt-dlp's skipped-fragment warning is direct evidence of incomplete media. */
export function createSkippedFragmentNote(skippedFragments: number): IncompleteDownloadNote | null {
  return skippedFragments > 0
    ? { kind: "incomplete_download", skippedFragments, gaps: [] }
    : null;
}
