import axios from "axios";
import type { Readable } from "node:stream";
import { buildBilibiliApiHeaders } from "../downloaders/bilibili/bilibiliHeaders";
import { resolveProxiedAxiosConfigForUrl } from "../downloaders/bilibili/bilibiliConfig";
import type { Video } from "../storageService/types";
import { MAX_DANMAKU_BYTES } from "./parser";

function validCid(value: unknown): string | undefined {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return undefined;
  const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
  return /^[1-9]\d{0,19}$/.test(text) ? text : undefined;
}

/** The page comes from the URL: a video's partNumber can be its ordinal within a collection instead. */
export function bilibiliDanmakuIdentity(video: Pick<Video, "sourceUrl">): { id: string; part: number } {
  const url = new URL(video.sourceUrl ?? "");
  const id = url.pathname.match(/^\/video\/(BV[a-zA-Z0-9]+|av\d+)(?:\/|$)/)?.[1];
  const part = Number(url.searchParams.get("p") ?? "1");
  if (!(url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com")) ||
      !id || !Number.isSafeInteger(part) || part < 1) throw new Error("danmakuUnsupportedSource");
  return { id, part };
}

/** Only accept CID hints already present in the current part's extractor metadata. */
export function extractDanmakuCid(metadata: Record<string, unknown>): string | undefined {
  const cid = validCid(metadata.cid);
  if (cid) return cid;
  const subtitles = metadata.subtitles as { danmaku?: Array<{ url?: string }> } | undefined;
  for (const item of subtitles?.danmaku ?? []) {
    try {
      const url = new URL(item.url ?? "");
      if (url.protocol === "https:" && url.hostname === "comment.bilibili.com") {
        const match = url.pathname.match(/^\/([1-9]\d{0,19})\.xml$/);
        if (match) return match[1];
      }
    } catch { /* Missing metadata uses the exact-part view API below. */ }
  }
  return undefined;
}

let activeRequests = 0;
const waiters: Array<() => void> = [];
function releaseRequest(): void {
  const next = waiters.shift();
  if (next) next();
  else activeRequests--;
}

async function requestText(url: string, signal: AbortSignal, subscriptionConfig?: string | null): Promise<string> {
  const proxy = resolveProxiedAxiosConfigForUrl(url, subscriptionConfig);
  if (proxy === null) throw new Error("danmakuProxyUnavailable");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  if (activeRequests >= 2) {
    if (waiters.length >= 20) throw new Error("danmakuBusy");
    await new Promise<void>(resolve => waiters.push(resolve));
  } else activeRequests++;
  try {
    deadline.throwIfAborted();
    const response = await axios.get<Readable>(url, {
      ...proxy, headers: buildBilibiliApiHeaders(url), signal: deadline,
      responseType: "stream", timeout: 15_000, maxRedirects: 0,
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of response.data) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_DANMAKU_BYTES) throw new Error("danmakuTooLarge");
        chunks.push(buffer);
      }
    } finally { response.data.destroy(); }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { releaseRequest(); }
}

export async function fetchBilibiliDanmaku(video: Video, signal: AbortSignal, options: { cid?: string; subscriptionConfig?: string | null } = {}) {
  const identity = bilibiliDanmakuIdentity(video);
  let cid = validCid(options.cid);
  if (!cid) {
    const key = identity.id.startsWith("BV") ? "bvid" : "aid";
    const id = identity.id.startsWith("BV") ? identity.id : identity.id.slice(2);
    const data = JSON.parse(await requestText(`https://api.bilibili.com/x/web-interface/view?${key}=${id}`, signal, options.subscriptionConfig));
    if (data.code !== 0 || !Array.isArray(data.data?.pages)) throw new Error("danmakuFetchFailed");
    const page = data.data.pages.find((item: { page?: number }) => item.page === identity.part);
    cid = validCid(page?.cid);
    if (!cid) throw new Error("danmakuMissingCid");
  }
  const xml = await requestText(`https://comment.bilibili.com/${cid}.xml`, signal, options.subscriptionConfig);
  return { xml, cid };
}
