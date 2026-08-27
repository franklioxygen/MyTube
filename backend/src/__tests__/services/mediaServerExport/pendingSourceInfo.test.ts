import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingSourceInfo,
  peekPendingSourceInfo,
  storePendingSourceInfo,
  takePendingSourceInfo,
} from "../../../services/mediaServerExport/pendingSourceInfo";

/**
 * Bridges a suppressed playlist_tv sync to the deferred one that follows it. The
 * downloader's envelope is the only source of an extractor's durable channel id,
 * and show identity is allocated once - so losing it here merges unrelated
 * channels permanently.
 */
describe("pendingSourceInfo", () => {
  beforeEach(() => {
    clearPendingSourceInfo();
  });

  it("returns the parked envelope to the deferred sync", () => {
    storePendingSourceInfo("v1", { channel_id: "UC123" });

    expect(takePendingSourceInfo("v1")).toEqual({ channel_id: "UC123" });
  });

  it("consumes the entry so a later rebuild does not reuse stale metadata", () => {
    storePendingSourceInfo("v1", { channel_id: "UC123" });

    takePendingSourceInfo("v1");

    expect(takePendingSourceInfo("v1")).toBeUndefined();
    expect(peekPendingSourceInfo("v1")).toBeUndefined();
  });

  it("reads without consuming when peeked", () => {
    storePendingSourceInfo("v1", { channel_id: "UC123" });

    expect(peekPendingSourceInfo("v1")).toEqual({ channel_id: "UC123" });
    expect(takePendingSourceInfo("v1")).toEqual({ channel_id: "UC123" });
  });

  it("returns undefined for a video that was never parked", () => {
    expect(takePendingSourceInfo("missing")).toBeUndefined();
  });

  it("ignores empty input rather than parking a useless entry", () => {
    storePendingSourceInfo("v1", undefined);
    storePendingSourceInfo("v2", null);
    storePendingSourceInfo("", { channel_id: "UC123" });

    expect(takePendingSourceInfo("v1")).toBeUndefined();
    expect(takePendingSourceInfo("v2")).toBeUndefined();
    expect(takePendingSourceInfo("")).toBeUndefined();
  });

  it("keeps entries separate per video", () => {
    storePendingSourceInfo("v1", { channel_id: "UC1" });
    storePendingSourceInfo("v2", { channel_id: "UC2" });

    expect(takePendingSourceInfo("v2")).toEqual({ channel_id: "UC2" });
    expect(takePendingSourceInfo("v1")).toEqual({ channel_id: "UC1" });
  });

  /**
   * A cancelled or failed download never triggers the link hook, so entries must
   * not accumulate for the life of the process.
   */
  it("bounds itself when link hooks never arrive", () => {
    for (let i = 0; i < 600; i += 1) {
      storePendingSourceInfo(`v${i}`, { channel_id: `UC${i}` });
    }

    // The oldest are evicted; the most recent survive.
    expect(peekPendingSourceInfo("v0")).toBeUndefined();
    expect(peekPendingSourceInfo("v599")).toEqual({ channel_id: "UC599" });
  });
});

/**
 * A playlist download can pass through more than one sync before its final
 * collection-link hook: legacy filename naming relocates the file in between.
 * Whoever is not last must peek rather than consume, or the last sync writes the
 * synthesized envelope over the extractor's own.
 */
describe("pendingSourceInfo across an intermediate sync", () => {
  beforeEach(() => {
    clearPendingSourceInfo();
  });

  it("survives a peek so the final sync still finds it", () => {
    storePendingSourceInfo("v1", { channel_id: "UC123", extractor: "youtube" });

    // Intermediate: the relocation sync.
    expect(peekPendingSourceInfo("v1")).toEqual({
      channel_id: "UC123",
      extractor: "youtube",
    });

    // Final: the collection-link hook.
    expect(takePendingSourceInfo("v1")).toEqual({
      channel_id: "UC123",
      extractor: "youtube",
    });
    expect(peekPendingSourceInfo("v1")).toBeUndefined();
  });

  it("tolerates repeated peeks", () => {
    storePendingSourceInfo("v1", { channel_id: "UC123" });

    peekPendingSourceInfo("v1");
    peekPendingSourceInfo("v1");

    expect(takePendingSourceInfo("v1")).toEqual({ channel_id: "UC123" });
  });
});
