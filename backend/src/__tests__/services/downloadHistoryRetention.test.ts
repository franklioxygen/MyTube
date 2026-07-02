import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  sqlite: { prepare: vi.fn() },
}));
vi.mock("../../services/storageService/settings", () => ({
  getSettings: vi.fn(),
}));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { db } from "../../db";
import { pruneDownloadHistory } from "../../services/storageService/downloadHistory";
import { getSettings } from "../../services/storageService/settings";

describe("pruneDownloadHistory", () => {
  const primeSubscriptionRetention = (retentionDays: number[]) => {
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          all: vi
            .fn()
            .mockReturnValue(retentionDays.map((d) => ({ retentionDays: d }))),
        }),
      }),
    });
  };

  const primeDelete = (changes: number) => {
    const run = vi.fn().mockReturnValue({ changes });
    (db.delete as any).mockReturnValue({
      where: vi.fn().mockReturnValue({ run }),
    });
    return run;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    primeSubscriptionRetention([]);
    primeDelete(0);
  });

  it("is a no-op while the setting is unset, zero, or invalid", () => {
    for (const value of [undefined, 0, -5, "not-a-number"]) {
      (getSettings as any).mockReturnValue({
        downloadHistoryRetentionDays: value,
      });
      expect(pruneDownloadHistory()).toBeNull();
    }
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("prunes with the configured window when no subscription retention exists", () => {
    (getSettings as any).mockReturnValue({ downloadHistoryRetentionDays: 30 });
    const run = primeDelete(12);

    const result = pruneDownloadHistory();

    expect(result).toEqual({ deletedRows: 12, effectiveRetentionDays: 30 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never prunes inside the widest subscription retention window", () => {
    (getSettings as any).mockReturnValue({ downloadHistoryRetentionDays: 30 });
    primeSubscriptionRetention([14, 90, 7]);
    primeDelete(3);

    const result = pruneDownloadHistory();

    // 90-day subscription retention + 1-day margin outranks the 30-day setting:
    // subscription retention discovers expired videos through these rows.
    expect(result).toEqual({ deletedRows: 3, effectiveRetentionDays: 91 });
  });

  it("uses the configured window when it exceeds subscription retention", () => {
    (getSettings as any).mockReturnValue({ downloadHistoryRetentionDays: 365 });
    primeSubscriptionRetention([30]);
    primeDelete(0);

    const result = pruneDownloadHistory();

    expect(result).toEqual({ deletedRows: 0, effectiveRetentionDays: 365 });
  });

  it("returns null instead of throwing when the delete fails", () => {
    (getSettings as any).mockReturnValue({ downloadHistoryRetentionDays: 30 });
    (db.delete as any).mockImplementation(() => {
      throw new Error("db locked");
    });

    expect(pruneDownloadHistory()).toBeNull();
  });
});
