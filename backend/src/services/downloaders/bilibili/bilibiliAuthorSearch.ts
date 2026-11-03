import axios from "axios";
import { getBilibiliAuthorId } from "../../../utils/bilibiliAuthor";
import { logger } from "../../../utils/logger";
import { resolveProxiedAxiosConfigForUrl } from "./bilibiliConfig";
import { buildBilibiliApiHeaders } from "./bilibiliHeaders";
import { stripSearchHighlight } from "./bilibiliSearch";
import { buildSignedBilibiliUrl } from "./bilibiliWbi";

export interface AuthorSearchResult {
  platform: "bilibili";
  authorId: string;
  displayName: string;
  channelUrl: string;
  avatarUrl: string;
}

export interface AuthorSearchPage {
  results: AuthorSearchResult[];
  page: number;
  hasMore: boolean;
  mode: "keyword" | "uid";
}

export class AuthorSearchUnavailableError extends Error {
  constructor(readonly code: "AUTHOR_SEARCH_UNAVAILABLE" | "AUTHOR_SEARCH_RISK_CONTROLLED" = "AUTHOR_SEARCH_UNAVAILABLE") {
    super(code === "AUTHOR_SEARCH_RISK_CONTROLLED"
      ? "Bilibili requires a security check. Try updating the Bilibili cookie in Settings, or look up an author by UID or profile URL."
      : "Bilibili author search is unavailable. Please retry later or look up an author by UID or profile URL.");
  }
}

/** Accept only public Bilibili image hosts and normalize safe avatar URLs to HTTPS. */
function avatarUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return "";
    if (!/(^|\.)(hdslb\.com|bilibili\.com)$/.test(url.hostname)) return "";
    url.protocol = "https:";
    return url.href;
  } catch {
    return "";
  }
}

/** Map a verified UID and display name to a canonical profile, rejecting incomplete entries. */
function formatAuthor(entry: Record<string, unknown>): AuthorSearchResult | null {
  const rawId = entry.mid;
  const id = typeof rawId === "string" || (typeof rawId === "number" && Number.isSafeInteger(rawId))
    ? getBilibiliAuthorId(String(rawId)) : null;
  const name = stripSearchHighlight(entry.uname ?? entry.name);
  if (!id || !name) return null;
  return {
    platform: "bilibili", authorId: id, displayName: name,
    channelUrl: `https://space.bilibili.com/${id}`,
    avatarUrl: avatarUrl(entry.upic ?? entry.face),
  };
}

/** One bounded page, independent from video search so upstream failures stay isolated. */
export async function searchBilibiliAuthors(query: string, page: number): Promise<AuthorSearchPage> {
  const id = getBilibiliAuthorId(query);
  const mode = id ? "uid" : "keyword";
  const proxyConfig = resolveProxiedAxiosConfigForUrl("https://www.bilibili.com/");
  if (!proxyConfig) throw new AuthorSearchUnavailableError();
  const config = { ...proxyConfig, timeout: 10_000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024 };
  try {
    const endpoint = id
      ? "https://api.bilibili.com/x/web-interface/card"
      : "https://api.bilibili.com/x/web-interface/wbi/search/type";
    const encodedParams = id
      ? `mid=${id}`
      : new URL(await buildSignedBilibiliUrl(endpoint, {
        search_type: "bili_user", keyword: query, page, page_size: 20,
      }, config)).search.slice(1);
    const requestConfig = {
      ...config,
      params: new URLSearchParams(encodedParams),
      // WBI signatures depend on the original query encoding (including %20 for spaces).
      paramsSerializer: { serialize: () => encodedParams },
    };
    const fetchPage = async (headers: Record<string, string>) => {
      try {
        return await axios.get(endpoint, { ...requestConfig, headers });
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 412) return error.response;
        throw error;
      }
    };
    const isRiskControlled = (response: { status?: number; data?: { code?: number; data?: { v_voucher?: unknown } } }): boolean =>
      response.status === 412 || response.data?.code === -352 || response.data?.code === -412 ||
      typeof response.data?.data?.v_voucher === "string";
    const headers = buildBilibiliApiHeaders(endpoint);
    let response = await fetchPage(headers);
    // These are public APIs. A stale/risk-controlled stored cookie can fail
    // while the same public lookup succeeds anonymously. Retry once, on the
    // same proxy, without modifying the saved cookie or retrying other errors.
    if (headers.Cookie && isRiskControlled(response)) {
      const anonymousHeaders = { ...headers };
      delete anonymousHeaders.Cookie;
      logger.warn("Bilibili author search cookie was rejected; retrying the public API anonymously");
      response = await fetchPage(anonymousHeaders);
    }
    if (isRiskControlled(response)) {
      logger.warn("Bilibili author search was blocked by upstream risk control");
      throw new AuthorSearchUnavailableError("AUTHOR_SEARCH_RISK_CONTROLLED");
    }
    const { data } = response;
    if (id && data?.code === -404) return { results: [], page: 1, hasMore: false, mode };
    if (data?.code !== 0) throw new AuthorSearchUnavailableError();
    if (id) {
      const card = data.data?.card;
      if (!card || typeof card !== "object") throw new AuthorSearchUnavailableError();
      const author = formatAuthor(card);
      if (!author || author.authorId !== id) throw new AuthorSearchUnavailableError();
      return { results: [author], page: 1, hasMore: false, mode };
    }
    const entries: unknown = data.data?.result;
    if (!Array.isArray(entries)) {
      if (data.data?.numResults === 0) return { results: [], page, hasMore: false, mode };
      throw new AuthorSearchUnavailableError();
    }
    const results = new Map<string, AuthorSearchResult>();
    for (const entry of entries.slice(0, 20)) {
      if (!entry || typeof entry !== "object") continue;
      const author = formatAuthor(entry);
      if (author) results.set(author.authorId, author);
    }
    const numPages = data.data?.numPages;
    const hasMore = page < 10 && (typeof numPages === "number" ? page < numPages : entries.length >= 20);
    return { results: [...results.values()], page, hasMore, mode };
  } catch (error) {
    if (error instanceof AuthorSearchUnavailableError) throw error;
    throw new AuthorSearchUnavailableError();
  }
}
