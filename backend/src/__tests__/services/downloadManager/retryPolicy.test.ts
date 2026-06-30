import { describe, expect, it } from "vitest";
import {
  normalizeAutoRetryIntervalMinutes,
  normalizeAutoRetryTimes,
  PARTIAL_STATUS,
  PENDING_RETRY_STATUS,
} from "../../../services/downloadManager/retryPolicy";

describe("downloadManager retryPolicy", () => {
  it("normalizes retry attempts to the supported range", () => {
    expect(normalizeAutoRetryTimes(undefined)).toBe(3);
    expect(normalizeAutoRetryTimes("bad")).toBe(3);
    expect(normalizeAutoRetryTimes(0)).toBe(1);
    expect(normalizeAutoRetryTimes("2.9")).toBe(2);
    expect(normalizeAutoRetryTimes(99)).toBe(10);
  });

  it("normalizes retry intervals to allowed minute options", () => {
    expect(normalizeAutoRetryIntervalMinutes(undefined)).toBe(5);
    expect(normalizeAutoRetryIntervalMinutes("bad")).toBe(5);
    expect(normalizeAutoRetryIntervalMinutes("10")).toBe(10);
    expect(normalizeAutoRetryIntervalMinutes(30.9)).toBe(30);
    expect(normalizeAutoRetryIntervalMinutes(2)).toBe(5);
  });

  it("exports shared retry status constants", () => {
    expect(PENDING_RETRY_STATUS).toBe("pending_retry");
    expect(PARTIAL_STATUS).toBe("partial");
  });
});
