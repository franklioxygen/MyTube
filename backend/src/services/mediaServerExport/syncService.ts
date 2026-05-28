import fs from "fs-extra";
import path from "path";
import { AVATARS_DIR, IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import {
  copyFileSafeSync,
  ensureDirSafeSync,
  linkSafeSync,
  pathExistsSafeSync,
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
import type {
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
  const tempPath = path.join(
    targetDirectory,
    `.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}`
  );

  ensureDirSafeSync(targetDirectory, allowedRoot);
  writeFileSafeSync(tempPath, allowedRoot, contents, { encoding: "utf8" });
  if (pathExistsSafeSync(targetPath, allowedRoot)) {
    fs.removeSync(targetPath);
  }
  fs.renameSync(tempPath, targetPath);
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

  try {
    linkSafeSync(sourcePath, sourceAllowedRoot, targetPath, allowedRoot);
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;

    if (code !== "EXDEV" && code !== "ENOTSUP" && code !== "EPERM") {
      logger.warn("Hard-linking sidecar artwork failed, copying instead", {
        code,
        targetPath,
      });
    }

    copyFileSafeSync(sourcePath, sourceAllowedRoot, targetPath, allowedRoot);
  }
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

function buildSourceInfoEnvelope(
  video: Video,
  rawSourceInfo?: unknown
): Record<string, unknown> {
  const subtitles = Array.isArray(video.subtitles)
    ? video.subtitles.reduce<Record<string, Array<Record<string, unknown>>>>(
        (acc, subtitle) => {
          const ext = path.extname(subtitle.filename).replace(/^\./, "") || "vtt";
          const key = subtitle.language || "unknown";
          if (!acc[key]) {
            acc[key] = [];
          }
          acc[key].push({
            ext,
            filename: subtitle.filename,
            path: subtitle.path,
          });
          return acc;
        },
        {}
      )
    : {};

  const synthesized: Record<string, unknown> = {
    id: video.id,
    title: video.title,
    uploader: video.author || undefined,
    upload_date: typeof video.date === "string" ? video.date.replace(/-/g, "") : undefined,
    description: video.description || undefined,
    webpage_url: video.sourceUrl || undefined,
    duration:
      video.duration !== undefined && video.duration !== null
        ? Number(video.duration)
        : undefined,
    thumbnail: video.thumbnailPath || video.thumbnailUrl || undefined,
    extractor: video.source || "unknown",
    channel_url: video.channelUrl || undefined,
    tags: Array.isArray(video.tags) ? video.tags : [],
    subtitles,
  };

  const rawSourcePreserved =
    typeof rawSourceInfo === "object" &&
    rawSourceInfo !== null &&
    !Array.isArray(rawSourceInfo);
  const mytubeMetadata = {
    generatedBy: "mytube",
    schemaVersion: 1,
    rawSourcePreserved,
  };

  if (rawSourcePreserved) {
    const rawSourceObject = rawSourceInfo as Record<string, unknown>;
    return {
      ...synthesized,
      ...rawSourceObject,
      _mytube: {
        ...(typeof rawSourceObject._mytube === "object" &&
        rawSourceObject._mytube !== null
          ? rawSourceObject._mytube
          : {}),
        ...mytubeMetadata,
      },
    };
  }

  return {
    ...synthesized,
    _mytube: mytubeMetadata,
  };
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

export function syncMediaServerShowArtifactsForRecord(
  video: Video,
  options: SyncMediaServerArtifactsOptions = {}
): void {
  try {
    const mode = getEffectiveMediaServerExportMode(options);
    if (mode === "off") {
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

export function syncMediaServerShowArtifactsForShowRoot(
  showRootRelativeDir: string,
  options: SyncMediaServerArtifactsOptions = {}
): void {
  try {
    const mode = getEffectiveMediaServerExportMode(options);
    if (mode === "off") {
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
      removeOwnedArtifact(path.join(showRootAbsolutePath, "tvshow.nfo"));
      for (const filename of ["show.jpg", "poster.jpg", "folder.jpg"]) {
        removeOwnedArtifact(path.join(showRootAbsolutePath, filename));
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

export function syncMediaServerArtifactsForRecord(
  video: Video,
  options: SyncMediaServerArtifactsOptions = {}
): void {
  try {
    const mode = getEffectiveMediaServerExportMode(options);
    if (mode === "off") {
      return;
    }

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
