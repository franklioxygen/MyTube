import axios from "axios";
import { BilibiliSearchUnavailableError } from "../../../errors/BilibiliSearchError";
import { logger } from "../../../utils/logger";
import { getUserYtDlpConfig } from "../../../utils/ytDlpUtils";
import { resolveProxiedAxiosConfig } from "./bilibiliConfig";
import { buildBilibiliApiHeaders } from "./bilibiliHeaders";
import { buildSignedBilibiliUrl } from "./bilibiliWbi";

const SEARCH_ENDPOINT =
  "https://api.bilibili.com/x/web-interface/wbi/search/type";
// The endpoint's maximum, so a page of results usually costs one request.
const UPSTREAM_PAGE_SIZE = 50;
// A hard ceiling on the upstream pages one call may read, plus at most one
// additional request to retry a cookie rejection anonymously. `offset` is not
// capped by the controller, so without this a single request carrying a large
// one is amplified into as many upstream requests as it takes to walk there -
// tying up the handler and spending Bilibili's rate limit - and the only thing
// stopping it is the upstream choosing to return a short page.
//
// This is not a cap on the window that can be paged to. The client stops
// collecting at 200 results, and a 50-entry page carries roughly 44 usable
// ones, so eight pages reach past 350: a raw-page count set from the filtered
// rate rather than assuming every entry survives the filter.
const MAX_UPSTREAM_PAGES = 8;
// A search URL yt-dlp would also accept, so the proxy-only-YouTube setting and
// any per-host bypass resolve for these requests the way they do for a download
// from the same site.
const BILIBILI_CONFIG_URL = "https://www.bilibili.com/";

interface BilibiliSearchEntry {
  bvid?: unknown;
  title?: unknown;
  author?: unknown;
  pic?: unknown;
  duration?: unknown;
  play?: unknown;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Search titles come back with the matched terms wrapped in
 * `<em class="keyword">…</em>` and the rest entity-escaped, so the raw value
 * would render as markup in the result card.
 */
export function stripSearchHighlight(title: unknown): string {
  if (typeof title !== "string") {
    return "";
  }

  // Repeated until the string stops changing, so the result is tag-free for
  // any nesting rather than only for the shapes one pass happens to cover. The
  // guarantee is the loop's, not the pattern's: narrow the pattern later (to
  // Bilibili's own `<em class="keyword">`, say) and a single pass would start
  // reassembling a tag out of the text either side of the one it removed.
  let stripped = title;
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(/<[^>]*>/g, "");
  } while (stripped !== previous);

  // Entities are decoded only after the tags are gone, so an escaped `&lt;b&gt;`
  // in a real title survives as visible text instead of becoming a tag that the
  // pass above has already run past.
  return stripped
    .replace(/&[a-zA-Z]+;|&#\d+;/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .trim();
}

/**
 * Bilibili reports a duration as colon-separated parts rather than seconds, and
 * the leading part is not capped at 60 — a 40-hour course reads "2398:14".
 * Passing that through would display as-is, so it is folded into seconds and
 * left for the client's own duration formatter.
 */
export function parseSearchDuration(duration: unknown): number | undefined {
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return duration;
  }
  if (typeof duration !== "string" || duration.trim() === "") {
    return undefined;
  }

  const parts = duration.trim().split(":");
  let seconds = 0;
  for (const part of parts) {
    const value = Number.parseInt(part, 10);
    if (!Number.isFinite(value)) {
      return undefined;
    }
    seconds = seconds * 60 + value;
  }
  return seconds;
}

/** Thumbnails are returned protocol-relative (`//i2.hdslb.com/...`). */
export function normalizeThumbnailUrl(pic: unknown): string {
  if (typeof pic !== "string" || pic === "") {
    return "";
  }
  if (pic.startsWith("//")) {
    return `https:${pic}`;
  }
  return pic;
}

/**
 * Map one search hit to the shape the search endpoint already returns for
 * YouTube. Entries without a bvid — paid "cheese" courses, live rooms — are not
 * downloadable video pages, so they are dropped by returning null.
 */
export function formatSearchEntry(
  entry: BilibiliSearchEntry
): Record<string, unknown> | null {
  const bvid = typeof entry.bvid === "string" ? entry.bvid : "";
  if (!bvid) {
    return null;
  }

  return {
    id: bvid,
    title: stripSearchHighlight(entry.title),
    author: typeof entry.author === "string" ? entry.author : "",
    thumbnailUrl: normalizeThumbnailUrl(entry.pic),
    duration: parseSearchDuration(entry.duration),
    viewCount: typeof entry.play === "number" ? entry.play : undefined,
    sourceUrl: `https://www.bilibili.com/video/${bvid}`,
    source: "bilibili",
  };
}

/**
 * Fetch one upstream page. Failures must never look like a successful empty page.
 */
async function fetchSearchPage(
  query: string,
  page: number,
  axiosConfig: Record<string, unknown>,
  requestState: { headers: Record<string, string>; anonymousRetryUsed: boolean }
): Promise<BilibiliSearchEntry[]> {
  try {
    // This endpoint is WBI-gated. Unsigned requests still succeed from
    // un-challenged IPs but come back `code: -352` from datacenter ranges, which
    // is where most self-hosted instances run.
    const encodedParams = new URL(await buildSignedBilibiliUrl(
      SEARCH_ENDPOINT,
      {
        search_type: "video",
        keyword: query,
        page,
        page_size: UPSTREAM_PAGE_SIZE,
      },
      axiosConfig
    )).search.slice(1);

    const fetchPage = async () => {
      try {
        return await axios.get(SEARCH_ENDPOINT, {
          ...axiosConfig,
          params: new URLSearchParams(encodedParams),
          // Preserve the exact encoding used to calculate the WBI signature.
          paramsSerializer: { serialize: () => encodedParams },
          headers: requestState.headers,
        });
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 412) return error.response;
        throw error;
      }
    };
    const isRiskControlled = (response: { status?: number; data?: { code?: number; data?: { v_voucher?: unknown } } }): boolean =>
      response.status === 412 || response.data?.code === -352 || response.data?.code === -412 ||
      typeof response.data?.data?.v_voucher === "string";
    let response = await fetchPage();
    if (isRiskControlled(response) && requestState.headers.Cookie && !requestState.anonymousRetryUsed) {
      requestState.headers = { ...requestState.headers };
      delete requestState.headers.Cookie;
      requestState.anonymousRetryUsed = true;
      logger.warn("Bilibili video search cookie was rejected; retrying the public API anonymously");
      response = await fetchPage();
    }
    if (isRiskControlled(response)) {
      logger.warn("Bilibili video search was blocked by upstream risk control", {
        page, httpStatus: response.status,
        apiCode: typeof response.data?.code === "number" ? response.data.code : undefined,
      });
      throw new BilibiliSearchUnavailableError("BILIBILI_SEARCH_RISK_CONTROLLED");
    }

    const data = response.data;
    if (!data || data.code !== 0) {
      logger.warn("Bilibili video search returned an unexpected API response", {
        page, httpStatus: response.status,
        apiCode: typeof data?.code === "number" ? data.code : undefined,
      });
      throw new BilibiliSearchUnavailableError();
    }

    if (Array.isArray(data.data?.result)) return data.data.result;
    if (data.data?.numResults === 0) return [];
    logger.warn("Bilibili video search response had no result array", { page });
    throw new BilibiliSearchUnavailableError();
  } catch (error) {
    if (error instanceof BilibiliSearchUnavailableError) throw error;
    // Exception messages/configs can contain proxy credentials, cookies or URLs.
    const axiosError = axios.isAxiosError(error) ? error : undefined;
    logger.warn("Bilibili video search request failed", {
      page, errorCode: axiosError?.code, httpStatus: axiosError?.response?.status,
    });
    throw new BilibiliSearchUnavailableError();
  }
}

/**
 * Search Bilibili for videos.
 *
 * yt-dlp's own `bilisearch:` key is not used here: it only resolves ids unless
 * every hit is extracted individually, so a flat search returns no title,
 * thumbnail, duration or view count to build a result card from. The web search
 * API returns all of that in one request, and this reuses the WBI signing the
 * space enumeration already needs for the same risk-control reason.
 *
 * `offset` is the 1-based index into the *returned* results, matching the
 * YouTube search path. It is deliberately not mapped onto an upstream page
 * number: a page mixes videos with paid courses and live rooms, which
 * `formatSearchEntry` drops, so the two indexes drift apart by however many
 * were dropped — around six per fifty. A caller that had seen 7 of the first
 * page's 8 usable hits would ask for offset 8, land back on page 1, and receive
 * nothing it did not already have, so "more" would stop working after one page.
 * The filtered stream is therefore walked from the start each time, which makes
 * the offset exact at the cost of re-reading pages the caller has already
 * consumed.
 */
export async function searchVideos(
  query: string,
  limit: number = 8,
  offset: number = 1
): Promise<any[]> {
  logger.info(
    `Processing Bilibili search request for query: "${query}", limit: ${limit}, offset: ${offset}`
  );

  const userConfig = getUserYtDlpConfig(BILIBILI_CONFIG_URL);
  const proxyConfig = resolveProxiedAxiosConfig(userConfig);
  if (!proxyConfig) {
    logger.warn(
      "Skipping Bilibili search: proxy is configured but unusable"
    );
    throw new BilibiliSearchUnavailableError();
  }
  const axiosConfig = { ...proxyConfig, timeout: 10_000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024 };
  const requestState = { headers: buildBilibiliApiHeaders(SEARCH_ENDPOINT), anonymousRetryUsed: false };

  const skip = Math.max(0, offset - 1);
  const wanted = Math.max(1, limit);
  const collected: Record<string, unknown>[] = [];
  let seen = 0;

  // Stops once the requested filtered window is filled, the upstream search
  // reports its final (short) page, or the request ceiling is reached.
  let reachedPageCeiling = false;
  for (let page = 1; page <= MAX_UPSTREAM_PAGES; page += 1) {
    const entries = await fetchSearchPage(query, page, axiosConfig, requestState);

    for (const entry of entries) {
      const formatted = formatSearchEntry(entry);
      if (!formatted) {
        continue;
      }
      if (seen >= skip) {
        collected.push(formatted);
      }
      seen += 1;
      if (collected.length >= wanted) {
        break;
      }
    }

    // A short page is the end of the results, not a transient gap.
    if (collected.length >= wanted || entries.length < UPSTREAM_PAGE_SIZE) {
      break;
    }
    reachedPageCeiling = page === MAX_UPSTREAM_PAGES;
  }

  if (reachedPageCeiling) {
    logger.warn(
      `Bilibili search for "${query}" stopped at the ${MAX_UPSTREAM_PAGES}-page request ceiling ` +
        `with ${collected.length} of ${wanted} results from offset ${offset}`
    );
  }

  logger.info(
    `Found ${collected.length} Bilibili search results for "${query}" (requested ${limit} from offset ${offset})`
  );

  return collected;
}
