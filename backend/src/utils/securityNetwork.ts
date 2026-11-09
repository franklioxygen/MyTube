import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

const LOOKUP_TIMEOUT = 10000;

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 32], // Teredo embeds IPv4 addresses.
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4 embeds IPv4 addresses.
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}
export function assertPublicAddress(address: string): void {
  const family = isIP(address);
  // BlockList also recognizes IPv4-mapped IPv6 addresses when checking IPv4
  // ranges. Reject other IPv6 scopes (including NAT64) outside global unicast.
  if (
    !family || blocked.check(address, family === 6 ? "ipv6" : "ipv4") ||
    (family === 6 && !globalIpv6.check(address, "ipv6"))
  ) {
    throw new Error("SSRF protection: Destination is not a public IP address");
  }
}

const normalizeHost = (hostname: string): string =>
  hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");

async function lookupHost(host: string, timeoutMs: number): Promise<LookupAddress[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SSRF protection: DNS lookup timed out")), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Resolve once and return only addresses safe to use as connection targets. */
export async function resolvePublicHost(hostname: string): Promise<LookupAddress[]> {
  const host = normalizeHost(hostname);
  if (isIP(host)) {
    assertPublicAddress(host);
    return [{ address: host, family: isIP(host) }];
  }

  const addresses = await lookupHost(host, LOOKUP_TIMEOUT);
  if (!addresses.length) throw new Error("SSRF protection: DNS returned no addresses");
  // Reject mixed public/private answers rather than picking a public answer
  // while another client or address-family fallback could choose a private one.
  for (const { address } of addresses) assertPublicAddress(address);
  return addresses;
}
