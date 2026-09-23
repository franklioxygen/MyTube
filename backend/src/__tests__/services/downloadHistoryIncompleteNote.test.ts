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
import {
  addDownloadHistoryItem,
  setIncompleteDownloadNote,
} from "../../services/storageService/downloadHistory";
import type {
  DownloadHistoryItem,
  IncompleteDownloadNote,
} from "../../services/storageService/types";

const NOTE: IncompleteDownloadNote = {
  kind: "incomplete_download",
  skippedFragments: 1,
  gaps: [{ stream: "video", atSeconds: 1127.92, gapSeconds: 4.03 }],
};
// Stored as JSON so the client can word it in the viewer's language.
const STORED = JSON.stringify(NOTE);

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
    // Notes are module state; start each test without one.
    setIncompleteDownloadNote("v1", null);
    setIncompleteDownloadNote("v2", null);
  });

  it("attaches the note to the video's success row and keeps it a success", () => {
    // Retention, renames and deletion tombstones all key on "success".
    setIncompleteDownloadNote("v1", NOTE);

    addDownloadHistoryItem(row());

    expect(written[0]).toMatchObject({ status: "success", videoId: "v1", error: STORED });
  });

  it("attaches it once", () => {
    setIncompleteDownloadNote("v1", NOTE);

    addDownloadHistoryItem(row());
    addDownloadHistoryItem(row({ id: "task-2" }));

    expect(written[1].error).toBeNull();
  });

  it("leaves other videos' rows alone", () => {
    setIncompleteDownloadNote("v1", NOTE);

    addDownloadHistoryItem(row({ videoId: "v2" }));

    expect(written[0].error).toBeNull();
  });

  it("does not attach to a row that is not a success", () => {
    setIncompleteDownloadNote("v1", NOTE);

    addDownloadHistoryItem(row({ status: "failed", error: "boom" }));

    expect(written[0].error).toBe("boom");
  });

  it("is cleared by a later clean save of the same video", () => {
    // A note from an attempt whose history row was never written must not
    // attach to the next, complete download.
    setIncompleteDownloadNote("v1", NOTE);
    setIncompleteDownloadNote("v1", null);

    addDownloadHistoryItem(row());

    expect(written[0].error).toBeNull();
  });

  it("stays bounded when notes are never collected", () => {
    for (let i = 0; i < 250; i += 1) setIncompleteDownloadNote(`orphan-${i}`, NOTE);
    setIncompleteDownloadNote("v1", NOTE);

    addDownloadHistoryItem(row({ videoId: "orphan-0" }));
    addDownloadHistoryItem(row());

    expect(written[0].error).toBeNull();
    expect(written[1].error).toBe(STORED);
  });
});
