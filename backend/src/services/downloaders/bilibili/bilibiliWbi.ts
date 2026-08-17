import { createHash } from "crypto";
import { logger } from "../../../utils/logger";

/**
 * WBI signing for api.bilibili.com endpoints under risk control.
 *
 * Bilibili gates several web APIs — `x/space/arc/search` among them — behind a
 * per-request signature. An unsigned request is not rejected everywhere: it
 * still succeeds from ordinary residential IPs, which is why this was easy to
 * miss. From datacenter ranges (where most self-hosted instances run) the same
 * request comes back HTTP 200 carrying `code: -352` (风控校验失败), so the caller
 * sees an application-level error rather than a transport failure.
 *
 * The signature is md5(sorted_query + mixin_key), where mixin_key is derived by
 * shuffling the concatenated img/sub key basenames published by the nav API
 * through a fixed index table.
 */

// Fixed shuffle table published by Bilibili's web client.
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

const MIXIN_KEY_LENGTH = 32;
// The keys rotate daily. Re-fetching per request would add a round trip to
// every page of every enumeration, so cache for an hour.
const WBI_KEY_TTL_MS = 60 * 60 * 1000;

export interface WbiKeys {
  imgKey: string;
  subKey: string;
}

interface CachedWbiKeys extends WbiKeys {
  fetchedAtMs: number;
}

let cachedKeys: CachedWbiKeys | null = null;
let inFlight: Promise<WbiKeys | null> | null = null;

/** Exposed for tests; also used when a caller wants a guaranteed fresh fetch. */
export function resetWbiKeyCache(): void {
  cachedKeys = null;
  inFlight = null;
}

/**
 * Derive the mixin key from the two nav-provided key basenames.
 */
export function getMixinKey(imgKey: string, subKey: string): string {
  const original = `${imgKey}${subKey}`;
  return MIXIN_KEY_ENC_TAB.map((index) => original[index] ?? "")
    .join("")
    .slice(0, MIXIN_KEY_LENGTH);
}

function keyBasename(url: unknown): string | null {
  if (typeof url !== "string" || !url) {
    return null;
  }
  const fileName = url.split("/").pop();
  if (!fileName) {
    return null;
  }
  const base = fileName.split(".")[0];
  return base || null;
}

/**
 * Fetch the current WBI keys from the nav API.
 *
 * nav answers `code: -101` (not logged in) for an anonymous caller but still
 * carries `data.wbi_img`, so the response code is deliberately not checked —
 * only the presence of both keys is.
 */
export async function fetchWbiKeys(
  axiosConfig: Record<string, unknown>
): Promise<WbiKeys | null> {
  const axios = await import("axios");
  try {
    const response = await axios.default.get(
      "https://api.bilibili.com/x/web-interface/nav",
      {
        ...axiosConfig,
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      }
    );

    const wbiImg = response?.data?.data?.wbi_img;
    const imgKey = keyBasename(wbiImg?.img_url);
    const subKey = keyBasename(wbiImg?.sub_url);
    if (!imgKey || !subKey) {
      logger.warn("Bilibili nav API returned no usable WBI keys");
      return null;
    }

    return { imgKey, subKey };
  } catch (error) {
    logger.warn(
      `Failed to fetch Bilibili WBI keys: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

async function getWbiKeys(
  axiosConfig: Record<string, unknown>
): Promise<WbiKeys | null> {
  if (cachedKeys && Date.now() - cachedKeys.fetchedAtMs < WBI_KEY_TTL_MS) {
    return { imgKey: cachedKeys.imgKey, subKey: cachedKeys.subKey };
  }

  // Enumeration fetches pages in a loop; without this every page would race a
  // separate nav request on a cold cache.
  if (!inFlight) {
    inFlight = fetchWbiKeys(axiosConfig).then((keys) => {
      if (keys) {
        cachedKeys = { ...keys, fetchedAtMs: Date.now() };
      }
      inFlight = null;
      return keys;
    });
  }

  return inFlight;
}

/**
 * Build the signed query string for a set of params.
 */
export function signWbiParams(
  params: Record<string, string | number>,
  keys: WbiKeys,
  nowMs: number = Date.now()
): string {
  const mixinKey = getMixinKey(keys.imgKey, keys.subKey);
  const signedParams: Record<string, string | number> = {
    ...params,
    wts: Math.round(nowMs / 1000),
  };

  const query = Object.keys(signedParams)
    .sort()
    .map((key) => {
      // Bilibili strips these characters from values before hashing; leaving
      // them in produces a signature the server will not reproduce.
      const value = String(signedParams[key]).replace(/[!'()*]/g, "");
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join("&");

  const wRid = createHash("md5").update(query + mixinKey).digest("hex");
  return `${query}&w_rid=${wRid}`;
}

/**
 * Build a fully signed request URL, or fall back to the unsigned query when the
 * keys cannot be fetched. Unsigned still works from un-challenged IPs, so a nav
 * failure should degrade rather than abort the enumeration.
 */
export async function buildSignedBilibiliUrl(
  endpoint: string,
  params: Record<string, string | number>,
  axiosConfig: Record<string, unknown>
): Promise<string> {
  const keys = await getWbiKeys(axiosConfig);
  if (!keys) {
    const unsigned = Object.keys(params)
      .sort()
      .map(
        (key) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`
      )
      .join("&");
    return `${endpoint}?${unsigned}`;
  }

  return `${endpoint}?${signWbiParams(params, keys)}`;
}
