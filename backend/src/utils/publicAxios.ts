import axios, { AxiosRequestConfig, AxiosResponse, LookupAddress } from "axios";
import type { LookupOptions } from "node:dns";
import net from "node:net";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { assertPublicAddress, resolvePublicHost } from "./securityNetwork";
import { validateUrl } from "./securityUrl";

const { getProxyForUrl } = require("proxy-from-env") as { getProxyForUrl(url: string): string };
const isProxyAgent = (agent: unknown) => agent instanceof SocksProxyAgent || agent instanceof HttpsProxyAgent;
const lookup = (hostname: string, options: LookupOptions,
  callback: (error: Error | null, address: LookupAddress | LookupAddress[], family?: 4 | 6) => void) => {
  void resolvePublicHost(hostname).then(addresses => {
    const selected = addresses.filter(item => !options.family || item.family === options.family)
      .map(item => ({ address: item.address, family: item.family === 6 ? 6 as const : 4 as const }));
    if (!selected.length) throw new Error("SSRF protection: no public address for the requested family");
    if (options.all) callback(null, selected);
    else callback(null, selected[0].address, selected[0].family);
  }).catch(error => callback(error, ""));
};

/** Pin direct lookups; retain Axios' own proxies, TLS, streams and redirects. */
export function publicAxiosGet<T = unknown>(url: string, config: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
  validateUrl(url);
  const parsed = new URL(url), literal = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literal)) assertPublicAddress(literal);
  if (config.transport || config.socketPath) throw new Error("SSRF protection: unsupported HTTP transport");
  for (const agent of [config.httpAgent, config.httpsAgent]) {
    if (agent && !isProxyAgent(agent)) throw new Error("SSRF protection: unsupported custom HTTP agent");
  }
  const initialAgent = parsed.protocol === "https:" ? config.httpsAgent : config.httpAgent;
  const proxied = isProxyAgent(initialAgent) || Boolean(config.proxy || (config.proxy !== false && getProxyForUrl(url)));
  return axios.get<T>(url, {
    ...config, adapter: "http", httpVersion: 1,
    lookup: proxied ? undefined : lookup,
    beforeRedirect(options, response, request) {
      config.beforeRedirect?.(options, response, request);
      // Axios has already applied the next hop's proxy policy before this hook.
      const absolute = /^https?:\/\//i.test(options.path || "");
      const agent = options.agents?.[options.protocol?.slice(0, -1)] ?? options.agent;
      const throughProxy = absolute || isProxyAgent(agent);
      if (absolute) validateUrl(options.path);
      else {
        const host = String(options.hostname || options.host || "").replace(/^\[|\]$/g, "");
        if (net.isIP(host)) assertPublicAddress(host);
      }
      options.lookup = throughProxy ? undefined : lookup;
    },
  });
}
