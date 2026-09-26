import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({
  db: { select: vi.fn(), delete: vi.fn(), insert: vi.fn(), update: vi.fn() },
  sqlite: { prepare: vi.fn() },
}));
vi.mock("../../services/storageService/settings", () => ({ getSettings: vi.fn() }));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { db } from "../../db";
import { addDownloadHistoryItem } from "../../services/storageService/downloadHistory";
import {
  withIncompleteDownloadNote,
  type DownloadHistoryItem,
  type IncompleteDownloadNote,
  type Video,
} from "../../services/storageService/types";

const NOTE: IncompleteDownloadNote = {
  kind: "incomplete_download",
  skippedFragments: 1,
  gaps: [{ stream: "video", atSeconds: 1127.92, gapSeconds: 4.03 }],
};

describe("incomplete download notes", () => {
  let written: Array<Record<string, unknown>>;

  const row = (over: Partial<DownloadHistoryItem> = {}): DownloadHistoryItem => ({
    id: "task-1",
    title: "A video",
    finishedAt: 1,
    status: "success",
    videoId: "v1",
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    written = [];
    (db.insert as any).mockReturnValue({
      values: vi.fn((values: Record<string, unknown>) => {
        written.push(values);
        return { onConflictDoUpdate: vi.fn(() => ({ run: vi.fn() })) };
      }),
    });
  });

  it("serializes the matching attempt's note on its success row", () => {
    addDownloadHistoryItem(row({ incompleteDownloadNote: NOTE }));

    expect(written[0]).toMatchObject({
      status: "success", videoId: "v1", error: JSON.stringify(NOTE),
    });
    expect(written[0]).not.toHaveProperty("incompleteDownloadNote");
  });

  it("keeps note and error off a clean attempt for the same video", () => {
    const savedVideo = { id: "v1", title: "A video", sourceUrl: "https://example.com", createdAt: "now" } as Video;
    const incompleteAttempt = withIncompleteDownloadNote(savedVideo, NOTE);
    const cleanAttempt = withIncompleteDownloadNote(savedVideo, null);

    addDownloadHistoryItem(row({ id: "clean", incompleteDownloadNote: cleanAttempt.incompleteDownloadNote }));
    addDownloadHistoryItem(row({ id: "incomplete", incompleteDownloadNote: incompleteAttempt.incompleteDownloadNote }));

    expect(written[0].error).toBeNull();
    expect(written[1].error).toBe(JSON.stringify(NOTE));
    expect(savedVideo.incompleteDownloadNote).toBeUndefined();
  });

  it("keeps two incomplete attempts for the same video separate", () => {
    const second = { ...NOTE, skippedFragments: 2 };

    addDownloadHistoryItem(row({ id: "second", incompleteDownloadNote: second }));
    addDownloadHistoryItem(row({ id: "first", incompleteDownloadNote: NOTE }));

    expect(written[0].error).toBe(JSON.stringify(second));
    expect(written[1].error).toBe(JSON.stringify(NOTE));
  });

  it("does not serialize a note on a failed row or override its error", () => {
    addDownloadHistoryItem(row({ status: "failed", error: "boom", incompleteDownloadNote: NOTE }));
    addDownloadHistoryItem(row({ id: "success", error: "other", incompleteDownloadNote: NOTE }));

    expect(written[0].error).toBe("boom");
    expect(written[1].error).toBe("other");
  });
});
