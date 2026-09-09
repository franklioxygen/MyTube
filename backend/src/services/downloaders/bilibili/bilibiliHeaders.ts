import { getCookieHeaderForUrl } from "../../../utils/ytdlp/cookies";

/**
 * Headers for a request to Bilibili's web API.
 *
 * The stored cookies are attached because api.bilibili.com now answers 412
 * (风控) to cookieless requests for x/web-interface/view — the preflight every
 * Bilibili collection subscription runs before it can read its feed. They are
 * selected for `requestUrl` specifically, so a path-scoped cookie is not sent
 * to an endpoint it does not cover. The user agent is a complete browser string
 * for the same risk-control reason: the truncated one this used to send is
 * itself a signal.
 */
export function buildBilibiliApiHeaders(
  requestUrl: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Referer: "https://www.bilibili.com",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  const cookie = getCookieHeaderForUrl(requestUrl);
  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}
