import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSettings = vi.fn();
const mockSaveSettings = vi.fn();

vi.mock("../../../db", () => ({
  // transaction(fn) returns a wrapped fn that runs fn when invoked, mirroring
  // better-sqlite3's API closely enough for the collector's batch ingest path.
  sqlite: { prepare: vi.fn(), transaction: vi.fn((fn: any) => fn) },
}));

vi.mock("../../../services/storageService", () => ({
  getSettings: () => mockGetSettings(),
  saveSettings: (...args: any[]) => mockSaveSettings(...args),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { sqlite } from "../../../db";
import {
  ensureFrozenTimezoneOnEnable,
  getResolvedTimezone,
  ingestBatch,
  invalidateStatisticsSettingsCache,
  isStatisticsEnabled,
  recordEvent,
  shouldTrackVisitorActivity,
} from "../../../services/statistics/collector";
import type { StatisticsEventInput } from "../../../services/statistics/eventTypes";

function makeStmt(opts: { run?: unknown; get?: unknown; all?: unknown } = {}) {
  return {
    run: vi.fn().mockReturnValue(opts.run ?? { changes: 0 }),
    get: vi.fn().mockReturnValue(opts.get ?? undefined),
    all: vi.fn().mockReturnValue(opts.all ?? []),
  };
}

function makeRecordEventInput(
  overrides: Partial<StatisticsEventInput> = {}
): StatisticsEventInput {
  return {
    eventType: "search_submitted",
    actorRole: "admin",
    surface: "web",
    ...overrides,
  };
}

describe("statistics collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateStatisticsSettingsCache();
    mockGetSettings.mockReturnValue({ statisticsEnabled: true, statisticsTrackVisitorActivity: true });
  });

  // ---- settings helpers ----

  describe("isStatisticsEnabled", () => {
    it("returns true when setting is true", () => {
      expect(isStatisticsEnabled()).toBe(true);
    });

    it("returns false when setting is false", () => {
      mockGetSettings.mockReturnValue({ statisticsEnabled: false });
      invalidateStatisticsSettingsCache();
      expect(isStatisticsEnabled()).toBe(false);
    });

    it("returns false when getSettings throws", () => {
      mockGetSettings.mockImplementation(() => { throw new Error("db down"); });
      invalidateStatisticsSettingsCache();
      expect(isStatisticsEnabled()).toBe(false);
    });
  });

  describe("shouldTrackVisitorActivity", () => {
    it("returns true when setting is true", () => {
      expect(shouldTrackVisitorActivity()).toBe(true);
    });

    it("returns false when setting is false", () => {
      mockGetSettings.mockReturnValue({ statisticsEnabled: true, statisticsTrackVisitorActivity: false });
      invalidateStatisticsSettingsCache();
      expect(shouldTrackVisitorActivity()).toBe(false);
    });

    it("returns false when getSettings throws", () => {
      mockGetSettings.mockImplementation(() => { throw new Error("oops"); });
      invalidateStatisticsSettingsCache();
      expect(shouldTrackVisitorActivity()).toBe(false);
    });
  });

  describe("getResolvedTimezone", () => {
    it("returns the stored timezone when set", () => {
      mockGetSettings.mockReturnValue({ statisticsEnabled: true, statisticsTimezone: "America/New_York" });
      invalidateStatisticsSettingsCache();
      expect(getResolvedTimezone()).toBe("America/New_York");
    });

    it("falls back to system timezone when setting is empty string", () => {
      mockGetSettings.mockReturnValue({ statisticsEnabled: true, statisticsTimezone: "" });
      invalidateStatisticsSettingsCache();
      const tz = getResolvedTimezone();
      expect(typeof tz).toBe("string");
      expect(tz.length).toBeGreaterThan(0);
    });

    it("falls back to UTC when getSettings throws", () => {
      mockGetSettings.mockImplementation(() => { throw new Error("gone"); });
      invalidateStatisticsSettingsCache();
      // Should not throw; returns either system TZ or "UTC"
      expect(() => getResolvedTimezone()).not.toThrow();
    });
  });

  describe("ensureFrozenTimezoneOnEnable", () => {
    it("returns existing timezone if already stored", () => {
      mockGetSettings.mockReturnValue({ statisticsTimezone: "Europe/Paris" });
      const tz = ensureFrozenTimezoneOnEnable();
      expect(tz).toBe("Europe/Paris");
      expect(mockSaveSettings).not.toHaveBeenCalled();
    });

    it("saves and returns current system timezone when none is stored", () => {
      mockGetSettings.mockReturnValue({});
      const tz = ensureFrozenTimezoneOnEnable();
      expect(typeof tz).toBe("string");
      expect(tz.length).toBeGreaterThan(0);
      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ statisticsTimezone: tz }),
        expect.any(Object)
      );
    });
  });

  // ---- recordEvent ----

  describe("recordEvent", () => {
    it("returns null when statistics is disabled", () => {
      mockGetSettings.mockReturnValue({ statisticsEnabled: false });
      invalidateStatisticsSettingsCache();

      const id = recordEvent(makeRecordEventInput());
      expect(id).toBeNull();
    });

    it("returns null when visitor activity is not tracked and actorRole is visitor", () => {
      mockGetSettings.mockReturnValue({ statisticsEnabled: true, statisticsTrackVisitorActivity: false });
      invalidateStatisticsSettingsCache();

      const id = recordEvent(makeRecordEventInput({ actorRole: "visitor" }));
      expect(id).toBeNull();
    });

    it("returns an event id when event is accepted", () => {
      const runMock = vi.fn();
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce(makeStmt({ get: undefined }) as any) // isDaySealed
        .mockReturnValueOnce({ run: runMock } as any)             // insertStatement
        .mockReturnValueOnce(makeStmt() as any)                   // markDayDirty
        .mockReturnValueOnce(makeStmt() as any);                  // bumpIngestionMinute (accepted)

      const id = recordEvent(makeRecordEventInput());
      expect(typeof id).toBe("string");
      expect(id).not.toBeNull();
    });

    it("drops event when day is sealed", () => {
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce(makeStmt({ get: { sealed: 1 } }) as any) // isDaySealed → sealed
        .mockReturnValueOnce(makeStmt() as any)                       // bumpIngestionMinute sealed
        .mockReturnValueOnce(makeStmt() as any);                      // bumpIngestionMinute dropped

      const id = recordEvent(makeRecordEventInput());
      expect(id).toBeNull();
    });

    it("returns null and does not throw on sqlite error", () => {
      vi.mocked(sqlite.prepare).mockImplementation(() => {
        throw new Error("insert failed");
      });

      const id = recordEvent(makeRecordEventInput());
      expect(id).toBeNull();
    });

    it("allows forceWrite to bypass disabled statistics", () => {
      mockGetSettings.mockReturnValue({ statisticsEnabled: false });
      invalidateStatisticsSettingsCache();
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce(makeStmt({ get: undefined }) as any)
        .mockReturnValueOnce({ run: vi.fn() } as any)
        .mockReturnValueOnce(makeStmt() as any)
        .mockReturnValueOnce(makeStmt() as any);

      const id = recordEvent(makeRecordEventInput(), { forceWrite: true });
      expect(id).not.toBeNull();
    });
  });

  // ---- ingestBatch ----

  describe("ingestBatch", () => {
    it("drops all events when statistics is disabled", () => {
      mockGetSettings.mockReturnValue({ statisticsEnabled: false });
      invalidateStatisticsSettingsCache();

      const result = ingestBatch(
        [{ eventType: "search_submitted" }, { eventType: "video_play_started" }],
        { actorRole: "admin", surface: "web" }
      );

      expect(result.droppedCount).toBe(2);
      expect(result.acceptedCount).toBe(0);
    });

    it("drops events with disallowed event types", () => {
      vi.mocked(sqlite.prepare).mockReturnValue(makeStmt() as any);

      const result = ingestBatch(
        [{ eventType: "download_queued" as any }],
        { actorRole: "admin", surface: "web" }
      );

      expect(result.droppedCount).toBe(1);
      expect(result.acceptedCount).toBe(0);
    });

    it("accepts valid allowed event types", () => {
      const runMock = vi.fn();
      vi.mocked(sqlite.prepare)
        .mockReturnValue(makeStmt() as any);
      // Override the insert statement mock specifically
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce(makeStmt({ get: undefined }) as any) // isDaySealed
        .mockReturnValueOnce({ run: runMock } as any)             // insert
        .mockReturnValueOnce(makeStmt() as any)                   // markDayDirty
        .mockReturnValueOnce(makeStmt() as any);                  // bumpIngestionMinute

      const result = ingestBatch(
        [{ eventType: "search_submitted", sessionId: "sess-1" }],
        { actorRole: "admin", surface: "web" }
      );

      expect(result.acceptedCount).toBe(1);
      expect(result.droppedCount).toBe(0);
    });

    it("drops the batch without throwing when the transaction fails to commit", () => {
      vi.mocked(sqlite.prepare).mockReturnValue(makeStmt() as any);
      // Simulate a commit-time failure (e.g. SQLITE_BUSY / disk full): the
      // transaction wrapper throws when invoked.
      vi.mocked(sqlite.transaction).mockReturnValueOnce((() => {
        throw new Error("database is locked");
      }) as any);

      const result = ingestBatch(
        [{ eventType: "search_submitted" }, { eventType: "video_play_started" }],
        { actorRole: "admin", surface: "web" }
      );

      expect(result).toEqual({
        acceptedCount: 0,
        droppedCount: 2,
        sealedDayDropCount: 0,
      });
    });

    it("handles mixed allowed and disallowed events", () => {
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce(makeStmt({ get: undefined }) as any)
        .mockReturnValueOnce({ run: vi.fn() } as any)
        .mockReturnValueOnce(makeStmt() as any)
        .mockReturnValueOnce(makeStmt() as any);

      const result = ingestBatch(
        [
          { eventType: "search_submitted" },
          { eventType: "download_queued" as any },
          { eventType: "video_play_started" },
        ],
        { actorRole: "admin", surface: "web" }
      );

      expect(result.acceptedCount + result.droppedCount).toBe(3);
      expect(result.droppedCount).toBeGreaterThanOrEqual(1);
    });

    it("counts sealed-day drops in sealedDayDropCount", () => {
      // insertStatement() is called before the per-event loop
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce({ run: vi.fn() } as any)                 // insertStatement
        .mockReturnValueOnce(makeStmt({ get: { sealed: 1 } }) as any) // isDaySealed → sealed
        .mockReturnValueOnce(makeStmt() as any)                       // bumpIngestionMinute sealed
        .mockReturnValueOnce(makeStmt() as any);                      // bumpIngestionMinute dropped

      const result = ingestBatch(
        [{ eventType: "search_submitted" }],
        { actorRole: "visitor", surface: "web" }
      );

      expect(result.sealedDayDropCount).toBe(1);
      expect(result.droppedCount).toBeGreaterThanOrEqual(1);
    });

    it("handles per-event sqlite errors gracefully (run throws inside loop)", () => {
      // insertStatement succeeds but ins.run() throws inside the per-event try-catch
      const throwingRun = vi.fn().mockImplementation(() => { throw new Error("write error"); });
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce({ run: throwingRun } as any)             // insertStatement
        .mockReturnValueOnce(makeStmt({ get: undefined }) as any)     // isDaySealed → not sealed
        .mockReturnValueOnce(makeStmt() as any);                      // bumpIngestionMinute error

      const result = ingestBatch(
        [{ eventType: "search_submitted" }],
        { actorRole: "admin", surface: "web" }
      );

      expect(result.droppedCount).toBe(1);
      expect(result.acceptedCount).toBe(0);
    });

    it("visitor events are allowed when statisticsTrackVisitorActivity is true", () => {
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce(makeStmt({ get: undefined }) as any)
        .mockReturnValueOnce({ run: vi.fn() } as any)
        .mockReturnValueOnce(makeStmt() as any)
        .mockReturnValueOnce(makeStmt() as any);

      const result = ingestBatch(
        [{ eventType: "video_play_started" }],
        { actorRole: "visitor", surface: "web" }
      );

      expect(result.acceptedCount).toBe(1);
    });

    it("neutralizes visitor-controlled classification and bounds watch duration", () => {
      const runMock = vi.fn();
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce({ run: runMock } as any)                 // insertStatement
        .mockReturnValueOnce(makeStmt({ get: undefined }) as any)     // isDaySealed
        .mockReturnValueOnce(makeStmt() as any)                       // markDayDirty
        .mockReturnValueOnce(makeStmt() as any);                      // bumpIngestionMinute

      const result = ingestBatch(
        [
          {
            eventType: "video_watch_chunk_recorded",
            sessionId: "attacker-session",
            platform: "youtube",
            sourceKind: "subscription",
            surface: "api",
            videoId: "video-1",
            durationSeconds: 86_400,
            value: 999,
            payload: { forged: true },
          },
        ],
        {
          actorRole: "visitor",
          surface: "web",
          serverSessionId: "web:server-derived-session",
        }
      );

      expect(result.acceptedCount).toBe(1);
      const insertedArgs = runMock.mock.calls[0];
      expect(insertedArgs[7]).toBe("web");
      expect(insertedArgs[8]).toBe("web:server-derived-session");
      expect(insertedArgs[14]).toBe("unknown");
      expect(insertedArgs[15]).toBe("unknown");
      expect(insertedArgs[16]).toBe(120);
      expect(insertedArgs[17]).toBeNull();
      expect(insertedArgs[18]).toBe("{}");
    });

    it("preserves bounded visitor search result counts without query text", () => {
      const runMock = vi.fn();
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce({ run: runMock } as any)                 // insertStatement
        .mockReturnValueOnce(makeStmt({ get: undefined }) as any)     // isDaySealed
        .mockReturnValueOnce(makeStmt() as any)                       // markDayDirty
        .mockReturnValueOnce(makeStmt() as any);                      // bumpIngestionMinute

      const result = ingestBatch(
        [
          {
            eventType: "search_submitted",
            sessionId: "attacker-session",
            platform: "youtube",
            sourceKind: "subscription",
            surface: "api",
            payload: {
              queryText: "private search",
              localResultCount: 2.4,
              externalResultCount: 99_999,
              extra: "dropped",
            },
          },
        ],
        {
          actorRole: "visitor",
          surface: "web",
          serverSessionId: "web:server-derived-session",
        }
      );

      expect(result.acceptedCount).toBe(1);
      const insertedArgs = runMock.mock.calls[0];
      expect(insertedArgs[14]).toBe("unknown");
      expect(insertedArgs[15]).toBe("unknown");
      expect(JSON.parse(insertedArgs[18])).toEqual({
        localResultCount: 2,
        externalResultCount: 10_000,
      });
    });
  });

  describe("invalidateStatisticsSettingsCache", () => {
    it("forces a fresh settings read on the next call", () => {
      isStatisticsEnabled(); // populates cache
      invalidateStatisticsSettingsCache();
      mockGetSettings.mockReturnValue({ statisticsEnabled: false });
      expect(isStatisticsEnabled()).toBe(false);
    });
  });
});
