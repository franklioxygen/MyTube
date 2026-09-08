import { extractSourceVideoId } from "../../utils/helpers";
import * as storageService from "../storageService";
import type { MediaType, Video } from "../storageService/types";

/**
 * Finds the library row a forced re-download is meant to replace, using the
 * same key the duplicate gate used to let that download through.
 *
 * The gate in videoDownloadController keys on (sourceVideoId, platform,
 * mediaType) via checkVideoDownloadBySourceId. Downloaders used to resolve the
 * row to replace by exact source_url equality instead, so any difference in URL
 * spelling - a mirror host, a fragment, a locale path segment, tracking
 * parameters - left them unable to recognise the row the gate had just
 * matched. The download then inserted a second row and left the previous file
 * on disk with nothing referencing it, because the superseded-file cleanup only
 * runs on the branch that found an existing row.
 *
 * Returns undefined rather than guessing whenever the tracking row is missing,
 * marked deleted, or points at a row that is gone; callers fall back to the URL
 * lookup, which still covers rows predating the tracking table.
 *
 * Not suitable for Bilibili: every part of a multipart video collapses onto one
 * tracking row, so this would resolve any part to whichever one that row names.
 * bilibiliSinglePart resolves through URL aliases for that reason.
 */
export function findRedownloadTargetBySourceIdentity(
  url: string,
  mediaType: MediaType
): Video | undefined {
  const { id: sourceVideoId, platform } = extractSourceVideoId(url);
  if (!sourceVideoId) {
    return undefined;
  }

  const tracked = storageService.checkVideoDownloadBySourceId(
    sourceVideoId,
    platform,
    mediaType
  );
  if (!tracked.found || tracked.status !== "exists" || !tracked.videoId) {
    return undefined;
  }

  const video = storageService.getVideoById(tracked.videoId);
  if (!video) {
    return undefined;
  }

  // The tracking row is keyed by media type, but a stale row could still name a
  // video of the other kind; keep the caller's contract exact.
  const videoMediaType: MediaType = video.mediaType === "audio" ? "audio" : "video";
  return videoMediaType === mediaType ? video : undefined;
}
