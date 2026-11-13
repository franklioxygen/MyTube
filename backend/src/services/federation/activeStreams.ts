import type { Response } from "express";

/**
 * Asset responses in flight, per issuing token. Revoking, suspending,
 * rotating or deleting a token ends its transfers at once instead of letting
 * a long video stream outlive the credential that started it (design §7.2).
 */
const streams = new Map<string, Set<Response>>();

export function trackFederationStream(tokenId: string, res: Response): void {
  let active = streams.get(tokenId);
  if (!active) {
    active = new Set();
    streams.set(tokenId, active);
  }
  const set = active;
  set.add(res);
  res.once("close", () => {
    set.delete(res);
    if (set.size === 0 && streams.get(tokenId) === set) {
      streams.delete(tokenId);
    }
  });
}

/** Ends the given tokens' transfers, or every transfer when none are named. */
export function endFederationStreams(tokenIds?: readonly string[]): number {
  const targets = tokenIds ?? [...streams.keys()];
  let ended = 0;
  for (const tokenId of targets) {
    const active = streams.get(tokenId);
    if (!active) continue;
    streams.delete(tokenId);
    for (const res of active) {
      res.destroy();
      ended += 1;
    }
  }
  return ended;
}

export function countFederationStreams(): number {
  let total = 0;
  for (const active of streams.values()) total += active.size;
  return total;
}
