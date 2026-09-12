/** Extract a YouTube video identity without accepting unrelated lookalike hosts. */
export function youtubeVideoId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    const host = url.hostname.toLowerCase();
    let id: string | null | undefined;
    if (host === "youtu.be" || host === "www.youtu.be") {
      id = url.pathname.split("/")[1];
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      id = url.pathname === "/watch"
        ? url.searchParams.get("v")
        : /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    }
    return id && /^[\w-]+$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Equivalent YouTube URLs share a key; other platforms retain exact URL identity. */
export function videoIdentity(videoUrl: string): string {
  const id = youtubeVideoId(videoUrl);
  return id ? `youtube:${id}` : `url:${videoUrl}`;
}

/** Compare a target to an optional cursor or probe result by media identity. */
export function sameVideo(left: string, right: string | null | undefined): boolean {
  return !!right && videoIdentity(left) === videoIdentity(right);
}
