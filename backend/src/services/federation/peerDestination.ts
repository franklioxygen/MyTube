import dns from "node:dns/promises";
import { isIP } from "node:net";
import { assertPublicAddress } from "../../utils/securityNetwork";

/**
 * Destination policy for federation peers (design §4.3).
 *
 * Only an administrator registers a peer, by a base URL. Public peers must
 * use HTTPS and get public-address checks on every request. A peer whose host
 * resolves only to private addresses is a LAN exception: exactly that origin
 * may use plain HTTP inside a home network, and every connection to it checks
 * again that the host still resolves only to private addresses (a DHCP address
 * change keeps working; a move to a public address is refused). Every request
 * is built from the stored base URL and fixed paths, never from input.
 */

export class PeerDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeerDestinationError";
  }
}

export interface PeerDestination {
  /** Origin plus optional base path, without a trailing slash. */
  baseUrl: string;
  /** Set for a private-network peer: the one origin allowed to skip checks. */
  lanOrigin: string | null;
}

export type HostResolver = (hostname: string) => Promise<string[]>;

const LOOKUP_TIMEOUT_MS = 10_000;

const defaultResolver: HostResolver = async (hostname) => {
  let timer: NodeJS.Timeout | undefined;
  try {
    const answers = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS lookup timed out")), LOOKUP_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
    return answers.map((answer) => answer.address);
  } finally {
    clearTimeout(timer);
  }
};

const isPublicAddress = (address: string): boolean => {
  try {
    assertPublicAddress(address);
    return true;
  } catch {
    return false;
  }
};

export async function resolvePeerDestination(
  input: string,
  resolve: HostResolver = defaultResolver
): Promise<PeerDestination> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new PeerDestinationError("The peer URL is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PeerDestinationError("The peer URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new PeerDestinationError("The peer URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new PeerDestinationError("The peer URL must not contain a query or fragment.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    throw new PeerDestinationError("The peer host could not be resolved.");
  }
  if (addresses.length === 0) {
    throw new PeerDestinationError("The peer host could not be resolved.");
  }

  const publicCount = addresses.filter(isPublicAddress).length;
  if (publicCount > 0 && publicCount < addresses.length) {
    // Picking either side could let a later lookup reach the other.
    throw new PeerDestinationError("The peer host resolves to both public and private addresses.");
  }
  const isPublic = publicCount === addresses.length;
  if (isPublic && url.protocol !== "https:") {
    throw new PeerDestinationError("A peer on a public address must use https.");
  }

  const baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return { baseUrl, lanOrigin: isPublic ? null : url.origin };
}
