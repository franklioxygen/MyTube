import { executeYtDlpSpawn, getAxiosProxyConfig, getNetworkConfigFromUserConfig, getUserYtDlpConfig } from "../utils/ytDlpUtils";
import { publicAxiosGet } from "../utils/publicAxios";
import { validateUploadedImageContent } from "../utils/uploadedImage";
import { searchBilibiliAuthors } from "./downloaders/bilibili/bilibiliAuthorSearch";
import { twitchApiService } from "./twitchService";
import type { AuthorAvatarSource } from "../utils/authorAvatarSources";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;

async function youtubeAvatarUrl(channelUrl: string, signal?: AbortSignal): Promise<string> {
  const config = getNetworkConfigFromUserConfig(getUserYtDlpConfig(channelUrl));
  const process = executeYtDlpSpawn(channelUrl, {
    ...config, dumpSingleJson: true, skipDownload: true, playlistItems: "0",
    noWarnings: true, socketTimeout: 10, retries: 0, extractorRetries: 0,
  });
  const info = await new Promise<{ thumbnails?: Array<{ id?: string; url?: string }> }>((resolve, reject) => {
    let stdout = "", bytes = 0, settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      process.kill("SIGKILL"); reject(error);
    };
    const abort = () => fail(new Error("Avatar fetch cancelled"));
    const timer = setTimeout(() => fail(new Error("YouTube avatar lookup timed out")), 40_000);
    signal?.addEventListener("abort", abort, { once: true });
    process.stdout?.on("data", (chunk: Buffer | string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_METADATA_BYTES) fail(new Error("Channel metadata is too large"));
      else if (!settled) stdout += chunk.toString();
    });
    // Consume stderr even when metadata is the only output we need.
    process.stderr?.on("data", () => undefined);
    Promise.resolve(process).then(() => {
      if (settled) return;
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      try { const parsed = JSON.parse(stdout); settled = true; resolve(parsed); }
      catch (error) { fail(error); }
    }, fail);
    if (signal?.aborted) abort();
  });
  // yt-dlp also returns channel banners. Never use a banner as an avatar.
  // https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_tab.py
  const avatar = info.thumbnails?.find(item => item.id === "avatar_uncropped")?.url;
  if (!avatar) throw new Error("The channel did not provide an avatar");
  return avatar;
}

/** Fetch bytes only: no profile, video, cached-default or asset writes before Save. */
export async function fetchAuthorSourceAvatar(source: AuthorAvatarSource, signal?: AbortSignal): Promise<{ buffer: Buffer; mime: string }> {
  let imageUrl: string | null | undefined;
  if (source.platform === "youtube") imageUrl = await youtubeAvatarUrl(source.channelUrl, signal);
  else if (source.platform === "bilibili") {
    const page = await searchBilibiliAuthors(source.channelUrl, 1);
    imageUrl = page.results.find(author => author.channelUrl === source.channelUrl)?.avatarUrl;
  } else {
    const login = new URL(source.channelUrl).pathname.slice(1);
    imageUrl = (await twitchApiService.getChannelByLogin(login))?.profileImageUrl;
  }
  if (!imageUrl) throw new Error("The channel did not provide an avatar");
  const userConfig = getUserYtDlpConfig(source.channelUrl);
  // A bad configured proxy must fail, never fall back to a direct connection.
  const proxyConfig = typeof userConfig.proxy === "string" ? getAxiosProxyConfig(userConfig.proxy) : {};
  const response = await publicAxiosGet<ArrayBuffer>(imageUrl, {
    ...proxyConfig, responseType: "arraybuffer", timeout: 15000, maxRedirects: 3,
    maxContentLength: MAX_IMAGE_BYTES, maxBodyLength: MAX_IMAGE_BYTES, signal,
    headers: { "Cache-Control": "no-cache" },
  });
  const buffer = Buffer.from(response.data);
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error("The downloaded image is too large or empty");
  const mime = await validateUploadedImageContent(buffer);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("The downloaded image format is not supported");
  return { buffer, mime };
}
