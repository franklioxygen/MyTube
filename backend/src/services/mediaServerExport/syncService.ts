import fs from "fs-extra";
import path from "path";
import { AVATARS_DIR, IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import { storePendingSourceInfo } from "./pendingSourceInfo";
import {
  copyFileSafeSync,
  ensureDirSafeSync,
  pathExistsSafeSync,
  renameSafeSync,
  resolveSafeChildPath,
  writeFileSafeSync,
} from "../../utils/security";
import { getSettings } from "../storageService/settings";
import { removeEmptyDirectoryChain } from "../storageService/fileHelpers";
import type { Video } from "../storageService";
import {
  buildEpisodeNfo,
  buildShowNfo,
  normalizeVideoDateToDay,
} from "./nfoBuilders";
import { planMediaServerExportPaths } from "./pathPlanner";
import { buildSourceInfoEnvelope } from "./sourceInfoEnvelope";
import {
  removePlaylistTvArtifactsForVideo,
  syncPlaylistTvForVideo,
} from "./playlistTvSync";
import type {
  MediaServerExportLayout,
  MediaServerExportMode,
  RemoveMediaServerArtifactsOptions,
  SyncMediaServerArtifactsOptions,
} from "./types";

function getLibraryVideos(options?: {
  libraryVideos?: Video[];
}): Video[] {
  if (options?.libraryVideos) {
    return options.libraryVideos;
  }

  const { getVideos } = require("../storageService/videos") as typeof import("../storageService/videos");
  return getVideos();
}

function getVideoById(videoId: string): Video | undefined {
  const { getVideoById } = require("../storageService/videos") as typeof import("../storageService/videos");
  return getVideoById(videoId);
}

function getMediaServerExportMode(): MediaServerExportMode {
  const settings = getSettings() as { mediaServerExportMode?: MediaServerExportMode };
  return settings.mediaServerExportMode || "off";
}

function getEffectiveMediaServerExportMode(
  options: SyncMediaServerArtifactsOptions
): MediaServerExportMode {
  return options.modeOverride || getMediaServerExportMode();
}

/**
 * Issue #411. Absent or unrecognized settings resolve to `adjacent`, so an
 * existing installation sees no behavior change until the user opts in.
 */
export function getMediaServerExportLayout(): MediaServerExportLayout {
  const settings = getSettings() as {
    mediaServerExportLayout?: MediaServerExportLayout;
  };
  return settings.mediaServerExportLayout === "playlist_tv"
    ? "playlist_tv"
    : "adjacent";
}

function getMediaServerCopyFallbackEnabled(): boolean {
  const settings = getSettings() as { mediaServerCopyFallback?: boolean };
  return settings.mediaServerCopyFallback !== false;
}

function getEffectiveMediaServerExportLayout(
  options: SyncMediaServerArtifactsOptions
): MediaServerExportLayout {
  return options.layoutOverride ?? getMediaServerExportLayout();
}

function getAllowedRootForPath(targetPath: string): string {
  return targetPath.startsWith(IMAGES_DIR + path.sep) ? IMAGES_DIR : VIDEOS_DIR;
}

function getAllowedRootForExistingArtifact(targetPath: string): string | null {
  if (targetPath.startsWith(VIDEOS_DIR + path.sep)) {
    return VIDEOS_DIR;
  }
  if (targetPath.startsWith(IMAGES_DIR + path.sep)) {
    return IMAGES_DIR;
  }
  if (targetPath.startsWith(AVATARS_DIR + path.sep)) {
    return AVATARS_DIR;
  }
  return null;
}

function removeOwnedArtifact(targetPath: string): void {
  const allowedRoot = getAllowedRootForPath(targetPath);
  if (!pathExistsSafeSync(targetPath, allowedRoot)) {
    return;
  }

  fs.removeSync(targetPath);
  removeEmptyDirectoryChain(path.dirname(targetPath), allowedRoot);
}

function atomicWriteTextFile(targetPath: string, contents: string): void {
  const allowedRoot = getAllowedRootForPath(targetPath);
  const targetDirectory = path.dirname(targetPath);
  const tempPath = resolveSafeChildPath(
    targetDirectory,
    `.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}`
  );

  ensureDirSafeSync(targetDirectory, allowedRoot);
  writeFileSafeSync(tempPath, allowedRoot, contents, { encoding: "utf8" });
  if (pathExistsSafeSync(targetPath, allowedRoot)) {
    fs.removeSync(targetPath);
  }
  renameSafeSync(tempPath, allowedRoot, targetPath, allowedRoot);
}

function syncImageAlias(sourcePath: string, targetPath: string): void {
  const allowedRoot = getAllowedRootForPath(targetPath);
  const sourceAllowedRoot = getAllowedRootForExistingArtifact(sourcePath);
  if (!sourceAllowedRoot) {
    logger.warn("Skipping artwork sidecar sync for unmanaged source path", {
      sourcePath,
      targetPath,
    });
    return;
  }

  ensureDirSafeSync(path.dirname(targetPath), allowedRoot);
  if (pathExistsSafeSync(targetPath, allowedRoot)) {
    fs.removeSync(targetPath);
  }

  copyFileSafeSync(sourcePath, sourceAllowedRoot, targetPath, allowedRoot);
}

function resolveLocalArtworkPath(
  webPath: string | undefined | null
): string | null {
  if (!webPath) {
    return null;
  }

  if (webPath.startsWith("/videos/")) {
    try {
      const absolutePath = resolveSafeChildPath(
        VIDEOS_DIR,
        webPath.replace(/^\/videos\//, "")
      );
      return pathExistsSafeSync(absolutePath, VIDEOS_DIR) ? absolutePath : null;
    } catch {
      return null;
    }
  }

  if (webPath.startsWith("/images/")) {
    try {
      const absolutePath = resolveSafeChildPath(
        IMAGES_DIR,
        webPath.replace(/^\/images\//, "")
      );
      return pathExistsSafeSync(absolutePath, IMAGES_DIR) ? absolutePath : null;
    } catch {
      return null;
    }
  }

  if (webPath.startsWith("/avatars/")) {
    try {
      const absolutePath = resolveSafeChildPath(
        AVATARS_DIR,
        webPath.replace(/^\/avatars\//, "")
      );
      return pathExistsSafeSync(absolutePath, AVATARS_DIR) ? absolutePath : null;
    } catch {
      return null;
    }
  }

  return null;
}

function matchesShowRoot(video: Video, showRootRelativeDir: string): boolean {
  const plan = planMediaServerExportPaths(video);
  return (
    plan?.tvLayout.isTvCompatible === true &&
    plan.tvLayout.showRootRelativeDir === showRootRelativeDir
  );
}

function getShowVideos(
  currentVideo: Video,
  showRootRelativeDir: string,
  libraryVideos: Video[]
): Video[] {
  const videosById = new Map<string, Video>();
  videosById.set(currentVideo.id, currentVideo);

  for (const video of libraryVideos) {
    if (matchesShowRoot(video, showRootRelativeDir)) {
      videosById.set(video.id, video);
    }
  }

  return Array.from(videosById.values());
}

function chooseShowPosterSourcePath(showVideos: Video[]): string | null {
  for (const video of showVideos) {
    const avatarPath = resolveLocalArtworkPath(video.authorAvatarPath);
    if (avatarPath) {
      return avatarPath;
    }
  }

  for (const video of showVideos) {
    const thumbnailPath = resolveLocalArtworkPath(video.thumbnailPath);
    if (thumbnailPath) {
      return thumbnailPath;
    }
  }

  return null;
}

function getShowPremiereDate(showVideos: Video[]): string | undefined {
  const normalizedDates = showVideos
    .map((video) => normalizeVideoDateToDay(video.date))
    .filter((value): value is string => Boolean(value))
    .sort();

  return normalizedDates[0];
}

function syncShowArtifacts(video: Video, libraryVideos: Video[]): void {
  const plan = planMediaServerExportPaths(video);
  if (
    !plan ||
    !plan.tvLayout.isTvCompatible ||
    !plan.tvLayout.showRootRelativeDir ||
    !plan.showNfoAbsolutePath
  ) {
    return;
  }

  const showVideos = getShowVideos(
    video,
    plan.tvLayout.showRootRelativeDir,
    libraryVideos
  );
  const showTitle = plan.tvLayout.showRootName || video.author || "Show";
  const showNfo = buildShowNfo({
    showTitle,
    plot: "",
    premiered: getShowPremiereDate(showVideos),
    studio:
      showVideos.find((candidate) => candidate.author)?.author || video.author,
  });
  atomicWriteTextFile(plan.showNfoAbsolutePath, showNfo);

  const showPosterSourcePath = chooseShowPosterSourcePath(showVideos);
  if (!showPosterSourcePath) {
    for (const posterPath of plan.showPosterAbsolutePaths) {
      removeOwnedArtifact(posterPath);
    }
    return;
  }

  for (const posterPath of plan.showPosterAbsolutePaths) {
    syncImageAlias(showPosterSourcePath, posterPath);
  }
}

/**
 * Adjacent-only: show artifacts live next to the original media there. In
 * `playlist_tv` the mirror owns every show artifact, so this is a no-op.
 */
export function syncMediaServerShowArtifactsForRecord(
  video: Video,
  options: SyncMediaServerArtifactsOptions = {}
): void {
  try {
    const mode = getEffectiveMediaServerExportMode(options);
    if (mode === "off") {
      return;
    }
    if (getEffectiveMediaServerExportLayout(options) === "playlist_tv") {
      return;
    }

    const plan = planMediaServerExportPaths(video);
    if (
      !plan ||
      !plan.tvLayout.isTvCompatible ||
      !plan.tvLayout.showRootRelativeDir
    ) {
      return;
    }

    syncShowArtifacts(video, getLibraryVideos(options));
  } catch (error) {
    logger.error("Failed to sync media server show artifacts", error, {
      videoId: video.id,
      videoPath: video.videoPath,
    });
  }
}

/** Adjacent-only, for the same reason as syncMediaServerShowArtifactsForRecord. */
export function syncMediaServerShowArtifactsForShowRoot(
  showRootRelativeDir: string,
  options: SyncMediaServerArtifactsOptions = {}
): void {
  try {
    const mode = getEffectiveMediaServerExportMode(options);
    if (mode === "off") {
      return;
    }
    if (getEffectiveMediaServerExportLayout(options) === "playlist_tv") {
      return;
    }

    const libraryVideos = getLibraryVideos(options);
    const showVideos = libraryVideos.filter((video) =>
      matchesShowRoot(video, showRootRelativeDir)
    );
    const showRootAbsolutePath = resolveSafeChildPath(
      VIDEOS_DIR,
      showRootRelativeDir
    );

    if (showVideos.length === 0) {
      removeOwnedArtifact(resolveSafeChildPath(showRootAbsolutePath, "tvshow.nfo"));
      for (const filename of ["show.jpg", "poster.jpg", "folder.jpg"]) {
        removeOwnedArtifact(resolveSafeChildPath(showRootAbsolutePath, filename));
      }
      removeEmptyDirectoryChain(showRootAbsolutePath, VIDEOS_DIR);
      return;
    }

    syncShowArtifacts(showVideos[0], libraryVideos);
  } catch (error) {
    logger.error("Failed to sync media server show artifacts by show root", error, {
      showRootRelativeDir,
    });
  }
}

function syncEpisodeArtifacts(
  video: Video,
  _mode: Exclude<MediaServerExportMode, "off">
): void {
  const plan = planMediaServerExportPaths(video);
  if (!plan || !pathExistsSafeSync(plan.videoAbsolutePath, VIDEOS_DIR)) {
    return;
  }

  const episodeThumbSourcePath = resolveLocalArtworkPath(video.thumbnailPath);
  if (episodeThumbSourcePath) {
    syncImageAlias(episodeThumbSourcePath, plan.episodeThumbAliasAbsolutePath);
  } else {
    removeOwnedArtifact(plan.episodeThumbAliasAbsolutePath);
  }

  const episodeNfo = buildEpisodeNfo({
    video,
    showTitle: plan.tvLayout.showRootName || video.author || "Show",
    seasonNumber: plan.tvLayout.seasonNumber,
    episodeNumber: plan.tvLayout.episodeNumber,
    thumbFilename: episodeThumbSourcePath
      ? path.basename(plan.episodeThumbAliasAbsolutePath)
      : undefined,
  });
  atomicWriteTextFile(plan.episodeNfoAbsolutePath, episodeNfo);
}

export function syncMediaServerArtifactsForVideo(
  videoId: string,
  options: SyncMediaServerArtifactsOptions = {}
): void {
  try {
    const video = getVideoById(videoId);
    if (!video) {
      return;
    }

    syncMediaServerArtifactsForRecord(video, options);
  } catch (error) {
    logger.error("Failed to sync media server artifacts by video id", error, {
      videoId,
    });
  }
}

/**
 * Layout dispatcher (issue #411, design §9.1).
 *
 * `adjacent` keeps the historical behavior byte-for-byte. `playlist_tv`
 * reconciles the durable catalog and materializes the managed mirror instead;
 * it never writes sidecars next to the original media.
 */
export function syncMediaServerArtifactsForRecord(
  video: Video,
  options: SyncMediaServerArtifactsOptions = {}
): void {
  const mode = getEffectiveMediaServerExportMode(options);
  if (mode === "off") {
    return;
  }

  if (getEffectiveMediaServerExportLayout(options) === "playlist_tv") {
    syncPlaylistTvArtifactsForRecord(video, mode, options);
    return;
  }

  syncAdjacentArtifactsForRecord(video, mode, options);
}

function syncPlaylistTvArtifactsForRecord(
  video: Video,
  mode: Exclude<MediaServerExportMode, "off">,
  options: SyncMediaServerArtifactsOptions
): void {
  try {
    // Playlist-origin downloads suppress this call and let the collection-link
    // caller reconcile instead, so a playlist item is never briefly classified
    // as an unassigned Season 00 episode. The downloader's raw envelope is
    // parked rather than dropped: the deferred sync has no other route to it,
    // and without it the episode loses its extractor source JSON and can
    // resolve a weaker, permanent show identity.
    if (options.suppressPlaylistTvSync) {
      storePendingSourceInfo(video.id, options.rawSourceInfo);
      return;
    }

    syncPlaylistTvForVideo(video.id, {
      mode,
      copyFallbackEnabled: getMediaServerCopyFallbackEnabled(),
      libraryVideos: options.libraryVideos,
      sourceJsonByVideoId: buildSourceJsonMap(video, mode, options),
    });
  } catch (error) {
    logger.error("Failed to sync playlist TV media server artifacts", error, {
      layout: "playlist_tv",
      action: "materialize",
      videoId: video.id,
    });
  }
}

function buildSourceJsonMap(
  video: Video,
  mode: Exclude<MediaServerExportMode, "off">,
  options: SyncMediaServerArtifactsOptions
): Map<string, string> | undefined {
  if (mode !== "nfo_and_source_json") {
    return undefined;
  }

  // Only a caller that actually has fresh extractor output supplies an
  // envelope. An ordinary refresh - a title edit, new tags, replaced artwork -
  // carries no `rawSourceInfo`, and synthesizing one here would hand the
  // materializer a weaker envelope that overwrites the rich `.info.json` the
  // download wrote. Left undefined, the materializer keeps whatever it already
  // published and still synthesizes for an episode that has none yet.
  if (options.rawSourceInfo === undefined) {
    return undefined;
  }

  return new Map([
    [
      video.id,
      `${JSON.stringify(
        buildSourceInfoEnvelope(video, options.rawSourceInfo),
        null,
        2
      )}\n`,
    ],
  ]);
}

function syncAdjacentArtifactsForRecord(
  video: Video,
  mode: Exclude<MediaServerExportMode, "off">,
  options: SyncMediaServerArtifactsOptions
): void {
  try {
    const plan = planMediaServerExportPaths(video);
    if (!plan || !pathExistsSafeSync(plan.videoAbsolutePath, VIDEOS_DIR)) {
      return;
    }

    syncEpisodeArtifacts(video, mode);

    if (mode === "nfo_and_source_json") {
      const sourceJson = JSON.stringify(
        buildSourceInfoEnvelope(video, options.rawSourceInfo),
        null,
        2
      );
      atomicWriteTextFile(
        plan.episodeSourceJsonAbsolutePath,
        `${sourceJson}\n`
      );
    }

    if (plan.tvLayout.isTvCompatible && plan.tvLayout.showRootRelativeDir) {
      syncShowArtifacts(video, getLibraryVideos(options));
    }
  } catch (error) {
    logger.error("Failed to sync media server artifacts", error, {
      videoId: video.id,
      videoPath: video.videoPath,
    });
  }
}

export function removeMediaServerArtifactsForVideo(
  video: Video,
  options: RemoveMediaServerArtifactsOptions = {}
): void {
  if ((options.layoutOverride ?? getMediaServerExportLayout()) === "playlist_tv") {
    try {
      removePlaylistTvArtifactsForVideo(video.id);
    } catch (error) {
      logger.error("Failed to remove playlist TV media server artifacts", error, {
        layout: "playlist_tv",
        action: "cleanup",
        videoId: video.id,
      });
    }
    return;
  }

  removeAdjacentArtifactsForVideo(video, options);
}

function removeAdjacentArtifactsForVideo(
  video: Video,
  options: RemoveMediaServerArtifactsOptions = {}
): void {
  try {
    const plan = planMediaServerExportPaths(video);
    if (!plan) {
      return;
    }

    removeOwnedArtifact(plan.episodeNfoAbsolutePath);
    removeOwnedArtifact(plan.episodeSourceJsonAbsolutePath);
    removeOwnedArtifact(plan.episodeThumbAliasAbsolutePath);

    if (!plan.tvLayout.isTvCompatible || !plan.tvLayout.showRootRelativeDir) {
      return;
    }

    const libraryVideos = getLibraryVideos(options);
    const showStillHasEpisodes = libraryVideos.some(
      (candidate) =>
        candidate.id !== video.id &&
        matchesShowRoot(candidate, plan.tvLayout.showRootRelativeDir as string)
    );

    if (showStillHasEpisodes) {
      return;
    }

    if (plan.showNfoAbsolutePath) {
      removeOwnedArtifact(plan.showNfoAbsolutePath);
    }
    for (const posterPath of plan.showPosterAbsolutePaths) {
      removeOwnedArtifact(posterPath);
    }
    if (plan.tvLayout.showRootRelativeDir) {
      const showRootAbsolutePath = resolveSafeChildPath(
        VIDEOS_DIR,
        plan.tvLayout.showRootRelativeDir
      );
      removeEmptyDirectoryChain(showRootAbsolutePath, VIDEOS_DIR);
    }
  } catch (error) {
    logger.error("Failed to remove media server artifacts", error, {
      videoId: video.id,
      videoPath: video.videoPath,
    });
  }
}

/**
 * The original media file moved on disk (a batch rename after an author-folder
 * or filename-template change), but it is the same library row.
 *
 * The two layouts need opposite handling, which is why this is not just a
 * remove-then-sync at the call site:
 *
 * - `adjacent` names its sidecars after the original file, so the artifacts at
 *   the old path really are stale and must be removed before new ones are
 *   written next to the new path.
 * - `playlist_tv` derives mirror paths from the show/season/episode allocation,
 *   never from the original filename. The mirror path does not move at all —
 *   only the hard link's source does — and the ledger already treats a changed
 *   `sourceAbsolutePath` as a relink. Removing artifacts here would delete the
 *   episode assignment along with them, and the reallocation that follows can
 *   hand the video a different episode number whenever its `sourcePosition` was
 *   taken by another episode after an upstream playlist reorder. That renames
 *   the file a media server has already scanned and destroys watch state, which
 *   is exactly what immutable numbering exists to prevent.
 */
export function syncMediaServerArtifactsForRelocatedRecord(
  previousVideo: Video,
  updatedVideo: Video,
  options: SyncMediaServerArtifactsOptions = {}
): void {
  if (getEffectiveMediaServerExportMode(options) === "off") {
    return;
  }

  if (getEffectiveMediaServerExportLayout(options) === "playlist_tv") {
    // Relink in place: assignments, episode numbers and export stems all stand.
    syncMediaServerArtifactsForRecord(updatedVideo, options);
    return;
  }

  const previousPlan = planMediaServerExportPaths(previousVideo);
  removeMediaServerArtifactsForVideo(previousVideo, options);
  if (previousPlan?.tvLayout.showRootRelativeDir) {
    syncMediaServerShowArtifactsForShowRoot(
      previousPlan.tvLayout.showRootRelativeDir,
      options
    );
  }
  syncMediaServerArtifactsForRecord(updatedVideo, options);
}

/**
 * The file behind a library row was replaced by a redownload. The row survives,
 * so this is a superseded *file*, never a deleted video.
 *
 * `adjacent` must drop the sidecars that were named after the old file. In
 * `playlist_tv` there is nothing to drop — mirror paths come from the catalog,
 * not the filename — and dropping would take the episode assignment with it,
 * risking the renumber described on syncMediaServerArtifactsForRelocatedRecord.
 * The re-sync that every caller runs afterwards relinks the mirror in place.
 */
export function removeMediaServerArtifactsForSupersededFile(
  video: Video,
  options: RemoveMediaServerArtifactsOptions = {}
): void {
  if ((options.layoutOverride ?? getMediaServerExportLayout()) === "playlist_tv") {
    return;
  }

  removeMediaServerArtifactsForVideo(video, options);
}
