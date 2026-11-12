import { getBilibiliAuthorId } from "./bilibiliAuthor";
import { extractTwitchChannelLogin } from "./twitch";

export interface AuthorAvatarSource {
  platform: "youtube" | "bilibili" | "twitch";
  channelUrl: string;
}

/** Only known channel routes, never arbitrary pages or caller-supplied image URLs. */
export function normalizeAvatarSource(value: unknown): AuthorAvatarSource | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(url.hostname)) {
      const match = url.pathname.match(/^\/(\@[^/]+|(?:channel|c|user)\/[^/]+)(?:\/(?:videos|shorts|streams|about|featured))?\/?$/);
      if (match) return { platform: "youtube", channelUrl: `https://www.youtube.com/${match[1]}` };
    }
    const bilibiliId = getBilibiliAuthorId(value);
    if (bilibiliId) return { platform: "bilibili", channelUrl: `https://space.bilibili.com/${bilibiliId}` };
    const twitchLogin = extractTwitchChannelLogin(value);
    if (twitchLogin) return { platform: "twitch", channelUrl: `https://www.twitch.tv/${twitchLogin}` };
  } catch { /* Malformed legacy metadata is not a downloadable source. */ }
  return null;
}

export function collectAvatarSources(channels: unknown[]): AuthorAvatarSource[] {
  const sources = new Map<string, AuthorAvatarSource>();
  for (const channel of channels) {
    const source = normalizeAvatarSource(channel);
    if (source) sources.set(source.channelUrl, source);
  }
  return [...sources.values()];
}
