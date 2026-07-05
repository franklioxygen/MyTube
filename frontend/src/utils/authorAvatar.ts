import { Video } from "../types";

const normalizeAuthorName = (author: string | undefined): string =>
  (author || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();

const normalizeChannelUrl = (channelUrl: unknown): string => {
  if (typeof channelUrl !== "string" || channelUrl.trim() === "") {
    return "";
  }

  try {
    const url = new URL(channelUrl.trim());
    url.hash = "";
    url.search = "";
    return `${url.hostname.toLocaleLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return channelUrl.trim().replace(/\/+$/, "").toLocaleLowerCase();
  }
};

const getSourceKey = (video: Video): string =>
  typeof video.source === "string" ? video.source.toLocaleLowerCase() : "";

const getAuthorFallbackKey = (video: Video): string => {
  const author = normalizeAuthorName(video.author);
  if (!author) {
    return "";
  }

  return `${getSourceKey(video)}:author:${author}`;
};

const getAuthorPrimaryKey = (video: Video): string => {
  const channelUrl = normalizeChannelUrl(video.channelUrl);
  if (channelUrl) {
    return `${getSourceKey(video)}:channel:${channelUrl}`;
  }

  return getAuthorFallbackKey(video);
};

const getAuthorAvatarFilename = (avatarPath: string): string | undefined => {
  const pathWithoutQuery = avatarPath.split(/[?#]/, 1)[0];
  const filename = pathWithoutQuery.split("/").filter(Boolean).pop();
  return filename || undefined;
};

export function buildAuthorAvatarPathMap(videos: Video[]): Map<string, string> {
  const avatarPathByKey = new Map<string, string>();

  for (const video of videos) {
    if (!video.authorAvatarPath) {
      continue;
    }

    const primaryKey = getAuthorPrimaryKey(video);
    const fallbackKey = getAuthorFallbackKey(video);

    if (primaryKey && !avatarPathByKey.has(primaryKey)) {
      avatarPathByKey.set(primaryKey, video.authorAvatarPath);
    }
    if (fallbackKey && !avatarPathByKey.has(fallbackKey)) {
      avatarPathByKey.set(fallbackKey, video.authorAvatarPath);
    }
  }

  return avatarPathByKey;
}

export function getCanonicalAuthorAvatarPath(
  video: Video,
  avatarPathByKey: Map<string, string>
): string | undefined {
  const primaryKey = getAuthorPrimaryKey(video);
  const fallbackKey = getAuthorFallbackKey(video);

  return (
    (primaryKey ? avatarPathByKey.get(primaryKey) : undefined) ||
    (fallbackKey ? avatarPathByKey.get(fallbackKey) : undefined) ||
    video.authorAvatarPath
  );
}

export function withCanonicalAuthorAvatar(
  video: Video,
  avatarPathByKey: Map<string, string>
): Video {
  const canonicalAvatarPath = getCanonicalAuthorAvatarPath(video, avatarPathByKey);

  if (!canonicalAvatarPath || canonicalAvatarPath === video.authorAvatarPath) {
    return video;
  }

  return {
    ...video,
    authorAvatarPath: canonicalAvatarPath,
    authorAvatarFilename:
      getAuthorAvatarFilename(canonicalAvatarPath) || video.authorAvatarFilename,
  };
}

export function withCanonicalAuthorAvatars(videos: Video[]): Video[] {
  const avatarPathByKey = buildAuthorAvatarPathMap(videos);
  let changed = false;

  const normalizedVideos = videos.map((video) => {
    const normalizedVideo = withCanonicalAuthorAvatar(video, avatarPathByKey);
    changed = changed || normalizedVideo !== video;
    return normalizedVideo;
  });

  return changed ? normalizedVideos : videos;
}
