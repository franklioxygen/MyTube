import path from "path";
import type { Video } from "../storageService";

/**
 * Build the `.info.json` payload written in `nfo_and_source_json` mode. The
 * synthesized MyTube fields are the base; a raw yt-dlp object, when one is
 * available, is layered on top so nothing the extractor reported is lost.
 */
export function buildSourceInfoEnvelope(
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
    upload_date:
      typeof video.date === "string" ? video.date.replace(/-/g, "") : undefined,
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
