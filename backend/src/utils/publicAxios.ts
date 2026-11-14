import axios, { AxiosRequestConfig, AxiosResponse, LookupAddress } from "axios";
import type { LookupOptions } from "node:dns";
import net from "node:net";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { assertPublicAddress, resolvePrivateHost, resolvePublicHost } from "./securityNetwork";
import { validateUrl } from "./securityUrl";

const { getProxyForUrl } = require("proxy-from-env") as { getProxyForUrl(url: string): string };
const isProxyAgent = (agent: unknown) => agent instanceof SocksProxyAgent || agent instanceof HttpsProxyAgent;
type Lookup = (hostname: string, options: LookupOptions,
  callback: (error: Error | null, address: LookupAddress | LookupAddress[], family?: 4 | 6) => void) => void;
/** Connect only to addresses `resolve` approved for this very socket. */
const pinnedLookup = (resolve: typeof resolvePublicHost): Lookup =>
  (hostname, options, callback) => {
    void resolve(hostname).then(addresses => {
      const selected = addresses.filter(item => !options.family || item.family === options.family)
        .map(item => ({ address: item.address, family: item.family === 6 ? 6 as const : 4 as const }));
      if (!selected.length) throw new Error("SSRF protection: no permitted address for the requested family");
      if (options.all) callback(null, selected);
      else callback(null, selected[0].address, selected[0].family);
    }).catch(error => callback(error, ""));
  };
const lookup = pinnedLookup(resolvePublicHost);
const privateLookup = pinnedLookup(resolvePrivateHost);

/**
 * An administrator-configured origin that may skip the public-address checks:
 * a storage server as a plain origin, or a LAN federation peer, whose host
 * must keep resolving only to private addresses (`privateOnly`).
 */
export type TrustedOrigin = string | { origin: string; privateOnly: true };

/** Pin direct lookups; retain Axios' own proxies, TLS, streams and redirects. */
function guardedConfig(url: string, config: AxiosRequestConfig, trustedOrigin?: TrustedOrigin): AxiosRequestConfig {
  // Only an administrator-configured origin may opt out of public-IP checks.
  const trust = typeof trustedOrigin === "string" ? { origin: trustedOrigin, privateOnly: false } : trustedOrigin;
  const origin = trust ? new URL(trust.origin).origin : undefined;
  const trustedLookup = trust?.privateOnly ? privateLookup : undefined;
  const checkTarget = (target: URL) => {
    if (["http:", "https:"].includes(target.protocol) && target.origin === origin) return true;
    validateUrl(target.href);
    const literal = target.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal)) assertPublicAddress(literal);
    return false;
  };
  const parsed = new URL(url), trusted = checkTarget(parsed);
  if (config.transport || config.socketPath) throw new Error("SSRF protection: unsupported HTTP transport");
  for (const agent of [config.httpAgent, config.httpsAgent]) {
    if (agent && !isProxyAgent(agent)) throw new Error("SSRF protection: unsupported custom HTTP agent");
  }
  const initialAgent = parsed.protocol === "https:" ? config.httpsAgent : config.httpAgent;
  const proxied = isProxyAgent(initialAgent) || Boolean(config.proxy || (config.proxy !== false && getProxyForUrl(url)));
  // Public direct sockets use validated lookups; administrator proxies/storage origins are trusted.
  return {
    ...config, adapter: "http", httpVersion: 1,
    lookup: proxied ? undefined : trusted ? trustedLookup : lookup,
    beforeRedirect(options, response, request) {
      config.beforeRedirect?.(options, response, request);
      // Axios has already applied the next hop's proxy policy before this hook.
      const absolute = /^https?:\/\//i.test(options.path || "");
      const agent = options.agents?.[options.protocol?.slice(0, -1)] ?? options.agent;
      const throughProxy = absolute || isProxyAgent(agent);
      const host = String(options.hostname || options.host || "").replace(/^\[|\]$/g, "");
      const authority = net.isIP(host) === 6 ? `[${host}]` : host;
      const target = new URL(absolute ? options.path : `${options.protocol}//${authority}${options.port ? `:${options.port}` : ""}/`);
      const trustedHop = checkTarget(target);
      options.lookup = throughProxy ? undefined : trustedHop ? trustedLookup : lookup;
    },
  };
}

export function publicAxiosGet<T = unknown>(url: string, config: AxiosRequestConfig = {}, trustedOrigin?: TrustedOrigin): Promise<AxiosResponse<T>> {
  const guarded = guardedConfig(url, config, trustedOrigin);
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  return axios.get<T>(url, guarded);
}

/** Any method, under the same guards as publicAxiosGet. */
export function publicAxiosRequest<T = unknown>(
  config: AxiosRequestConfig & { url: string },
  trustedOrigin?: TrustedOrigin
): Promise<AxiosResponse<T>> {
  const guarded = guardedConfig(config.url, config, trustedOrigin);
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  return axios.request<T>({ ...guarded, url: config.url });
}
