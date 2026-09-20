import axios from "axios";
import { logger } from "../../../utils/logger";
import { getUserYtDlpConfig } from "../../../utils/ytDlpUtils";
import { resolveProxiedAxiosConfig } from "./bilibiliConfig";
import { buildBilibiliApiHeaders } from "./bilibiliHeaders";
import { buildSignedBilibiliUrl } from "./bilibiliWbi";

const SEARCH_ENDPOINT =
  "https://api.bilibili.com/x/web-interface/wbi/search/type";
// The endpoint's maximum, so a page of results usually costs one request.
const UPSTREAM_PAGE_SIZE = 50;
// A hard ceiling on the outbound requests one call may make. `offset` is not
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
 * Fetch one upstream page. Returns null when the API refused the request, which
 * the caller must not confuse with a page that legitimately held nothing.
 */
async function fetchSearchPage(
  query: string,
  page: number,
  axiosConfig: Record<string, unknown>
): Promise<BilibiliSearchEntry[] | null> {
  // This endpoint is WBI-gated. Unsigned requests still succeed from
  // un-challenged IPs but come back `code: -352` from datacenter ranges, which
  // is where most self-hosted instances run.
  const requestUrl = await buildSignedBilibiliUrl(
    SEARCH_ENDPOINT,
    {
      search_type: "video",
      keyword: query,
      page,
      page_size: UPSTREAM_PAGE_SIZE,
    },
    axiosConfig
  );

  // The SSRF rule's taint source is the first parameter of any function taking
  // two or more - it assumes an Express `(req, res)` handler - so `query` here
  // is treated as attacker-controlled request data. It is not a URL: requestUrl
  // is built from the SEARCH_ENDPOINT constant above, and every param the
  // caller supplies, the keyword included, is percent-encoded into the query
  // string by both the signed and unsigned branches of buildSignedBilibiliUrl,
  // so the host is not reachable from it.
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const response = await axios.get(requestUrl, {
    ...axiosConfig,
    headers: buildBilibiliApiHeaders(requestUrl),
  });

  const data = response.data;
  if (!data || data.code !== 0) {
    // Risk control answers HTTP 200 with a non-zero code, so this is the only
    // place the failure is visible.
    logger.warn(
      `Bilibili search failed for "${query}": code ${data?.code}, message ${data?.message}`
    );
    return null;
  }

  return Array.isArray(data.data?.result) ? data.data.result : [];
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
  const axiosConfig = resolveProxiedAxiosConfig(userConfig);
  if (!axiosConfig) {
    logger.warn(
      "Skipping Bilibili search: proxy is configured but unusable"
    );
    return [];
  }

  const skip = Math.max(0, offset - 1);
  const wanted = Math.max(1, limit);
  const collected: Record<string, unknown>[] = [];
  let seen = 0;

  // Stops once the requested filtered window is filled, the upstream search
  // reports its final (short) page, or the request ceiling is reached.
  let reachedPageCeiling = false;
  for (let page = 1; page <= MAX_UPSTREAM_PAGES; page += 1) {
    const entries = await fetchSearchPage(query, page, axiosConfig);
    if (entries === null) {
      break;
    }

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
