import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscriptions } from "../../db/schema";
import { YtDlpDownloader } from "../../services/downloaders/YtDlpDownloader";
import * as downloadService from "../../services/downloadService";
import * as storageService from "../../services/storageService";
import { TelegramService } from "../../services/telegramService";
import { subscriptionService, Subscription } from "../../services/subscriptionService";
import { getVideoRetry, listVideoRetries, queueVideoRetry } from "../../services/subscription/videoRetries";
import { executeYtDlpJson, getEffectiveUserYtDlpConfig } from "../../utils/ytDlpUtils";

const mocks = vi.hoisted(() => ({ db: undefined as any }));
vi.mock("../../db", () => ({ get db() { return mocks.db; } }));
vi.mock("../../services/downloadService");
vi.mock("../../services/storageService");
vi.mock("../../services/downloaders/YtDlpDownloader");
vi.mock("../../services/downloaders/BilibiliDownloader");
vi.mock("../../services/downloadManager", () => ({
  default: { addDownload: vi.fn((download: Function) => download(vi.fn())) },
}));
vi.mock("../../services/telegramService", () => ({
  TelegramService: { notifyTaskComplete: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../services/statistics", () => ({
  recordEvent: vi.fn(), bucketDownloadError: () => "unknown",
}));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../utils/ytDlpUtils", () => ({
  executeYtDlpJson: vi.fn(),
  getEffectiveUserYtDlpConfig: vi.fn().mockReturnValue({}),
  getUserYtDlpConfig: vi.fn().mockReturnValue({}),
  getNetworkConfigFromUserConfig: vi.fn().mockReturnValue({}),
}));

describe("subscription settlement across checks with SQLite", () => {
  let sqlite: Database.Database;
  const shortUrl = "https://www.youtube.com/shorts/latest";
  const oldShortUrl = "https://www.youtube.com/shorts/old";
  const media = new Map<string, any>();
  const membersOnly = new Error("Join this channel to get access to members-only content");

  const readSubscription = () => mocks.db.select().from(subscriptions)
    .where(eq(subscriptions.id, "sub")).get();
  const check = () => (subscriptionService as unknown as {
    checkSingleSubscription(sub: Subscription): Promise<void>;
  }).checkSingleSubscription(readSubscription());
  const attempts = (url: string) => vi.mocked(downloadService.downloadYouTubeVideo)
    .mock.calls.filter(([target]) => target === url);
  const history = (url: string) => vi.mocked(storageService.addDownloadHistoryItem)
    .mock.calls.filter(([item]) => item.sourceUrl === url);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(TelegramService.notifyTaskComplete).mockResolvedValue(undefined);
    vi.mocked(getEffectiveUserYtDlpConfig).mockReturnValue({});
    media.clear();
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    mocks.db = drizzle(sqlite);
    migrate(mocks.db, { migrationsFolder: "drizzle" });
    mocks.db.insert(subscriptions).values({
      id: "sub", author: "Author", authorUrl: "https://www.youtube.com/@author",
      interval: 60, createdAt: 1, downloadShorts: 1,
      lastShortVideoLink: oldShortUrl, downloadCount: 5,
    }).run();
    vi.mocked(YtDlpDownloader.getLatestVideoUrl).mockResolvedValue(null);
    vi.mocked(YtDlpDownloader.getLatestShortsUrl).mockResolvedValue(shortUrl);
    vi.mocked(storageService.getVideoBySourceUrl).mockImplementation(url => media.get(url));
    vi.mocked(storageService.addVideoToCollection).mockReturnValue({ id: "collection" } as any);
    vi.mocked(downloadService.downloadYouTubeVideo).mockImplementation(async url => {
      const videoData = { id: url, title: "Downloaded" };
      media.set(url, videoData);
      return { videoData } as any;
    });
  });
  afterEach(() => sqlite.close());

  function fillBatchBeforeHead() {
    for (let i = 0; i < 5; i++) queueVideoRetry("sub", `https://www.youtube.com/shorts/batch-${i}`, i + 1);
    queueVideoRetry("sub", shortUrl, 7);
    sqlite.exec("UPDATE subscription_video_retries SET created_at = 1");
    expect(listVideoRetries("sub").map(row => row.videoUrl)).not.toContain(shortUrl);
  }

  it.each(["skip", "download", "existing"])(
    "removes a %s settled outside the batch so later checks cannot repeat it",
    async outcome => {
      fillBatchBeforeHead();
      if (outcome === "existing") media.set(shortUrl, { id: "existing" });
      if (outcome === "skip") vi.mocked(downloadService.downloadYouTubeVideo).mockRejectedValue(membersOnly);

      await check();
      expect(getVideoRetry("sub", shortUrl)).toBeUndefined();
      expect(readSubscription().lastShortVideoLink).toBe(shortUrl);
      await check();
      expect(attempts(shortUrl)).toHaveLength(outcome === "existing" ? 0 : 1);
      expect(history(shortUrl)).toHaveLength(outcome === "existing" ? 0 : 1);
      expect(readSubscription().downloadCount).toBe(outcome === "skip" ? 5 : outcome === "existing" ? 10 : 11);
    }
  );

  it("does not rewind a settled Shorts cursor when older members-only retries rotate in", async () => {
    mocks.db.update(subscriptions).set({ lastShortVideoLink: shortUrl }).run();
    queueVideoRetry("sub", oldShortUrl);
    vi.mocked(downloadService.downloadYouTubeVideo).mockRejectedValue(membersOnly);
    await check();
    expect(readSubscription().lastShortVideoLink).toBe(shortUrl);
    expect(getVideoRetry("sub", oldShortUrl)).toBeUndefined();
    await check();
    expect(attempts(shortUrl)).toHaveLength(0);
    expect(history(oldShortUrl)).toHaveLength(1);
  });

  it("settles a skipped retry at the current Shorts head only once", async () => {
    queueVideoRetry("sub", shortUrl);
    vi.mocked(downloadService.downloadYouTubeVideo).mockRejectedValue(membersOnly);
    await check();
    await check();
    expect(readSubscription().lastShortVideoLink).toBe(shortUrl);
    expect(attempts(shortUrl)).toHaveLength(1);
    expect(history(shortUrl)).toHaveLength(1);
  });

  it.each(["short", "video"])("preserves an out-of-batch %s head's backfill position", async kind => {
    fillBatchBeforeHead();
    if (kind === "video") {
      mocks.db.update(subscriptions).set({ downloadShorts: 0 }).run();
      vi.mocked(YtDlpDownloader.getLatestVideoUrl).mockResolvedValue(shortUrl);
    }
    await check();
    expect(attempts(shortUrl)[0][1]).toMatchObject({
      filenameTemplateSourceOptions: { mediaPlaylistIndex: 7 },
    });
  });

  it("retains a failed out-of-batch Short and rotates its attempt", async () => {
    fillBatchBeforeHead();
    vi.mocked(downloadService.downloadYouTubeVideo).mockRejectedValue(new Error("timed out"));
    await check();
    expect(getVideoRetry("sub", shortUrl)?.lastAttemptAt).toBeGreaterThan(0);
    expect(readSubscription().lastShortVideoLink).toBe(oldShortUrl);
    expect(attempts(shortUrl)).toHaveLength(1);
    expect(history(shortUrl)).toHaveLength(1);
  });

  it.each(["download", "existing"])("keeps an out-of-batch %s retry until its collection is repaired", async outcome => {
    fillBatchBeforeHead();
    mocks.db.update(subscriptions).set({ subscriptionType: "playlist", collectionId: "collection" }).run();
    vi.mocked(executeYtDlpJson).mockResolvedValue({ entries: [] });
    if (outcome === "existing") media.set(shortUrl, { id: shortUrl });
    vi.mocked(storageService.addVideoToCollection).mockReturnValue(null);
    await check();
    expect(getVideoRetry("sub", shortUrl)).toBeDefined();
    expect(readSubscription().lastCheckStatus).toBe("fail");

    vi.mocked(storageService.addVideoToCollection).mockReturnValue({ id: "collection" } as any);
    await check();
    await check(); // A full batch can place the settled head in the next rotation.
    expect(getVideoRetry("sub", shortUrl)).toBeUndefined();
    expect(storageService.addVideoToCollection).toHaveBeenCalledWith("collection", shortUrl);
    expect(attempts(shortUrl)).toHaveLength(outcome === "existing" ? 0 : 1);
  });

  it("recovers a downloaded Short after its cursor write fails and the head changes", async () => {
    sqlite.exec(`CREATE TRIGGER fail_short_cursor BEFORE UPDATE OF last_short_video_link ON subscriptions
      BEGIN SELECT RAISE(FAIL, 'cursor update failed'); END`);
    await check();
    expect(getVideoRetry("sub", shortUrl)).toBeDefined();
    expect(readSubscription().downloadCount).toBe(6);
    expect(readSubscription().lastCheckStatus).toBe("fail");

    sqlite.exec("DROP TRIGGER fail_short_cursor");
    vi.mocked(YtDlpDownloader.getLatestShortsUrl).mockResolvedValue("https://www.youtube.com/shorts/newer");
    await check();
    expect(getVideoRetry("sub", shortUrl)).toBeUndefined();
    expect(attempts(shortUrl)).toHaveLength(1);
    expect(readSubscription().downloadCount).toBe(7);
  });

  it("keeps a skipped retry pending when the Shorts probe fails, without blocking the main head", async () => {
    queueVideoRetry("sub", shortUrl);
    vi.mocked(YtDlpDownloader.getLatestShortsUrl).mockRejectedValue(new Error("probe timed out"));
    const mainUrl = "https://www.youtube.com/watch?v=new";
    vi.mocked(YtDlpDownloader.getLatestVideoUrl).mockResolvedValue(mainUrl);
    vi.mocked(downloadService.downloadYouTubeVideo).mockRejectedValueOnce(membersOnly);
    await check();
    expect(getVideoRetry("sub", shortUrl)).toBeDefined();
    expect(history(shortUrl)).toHaveLength(0);
    expect(attempts(mainUrl)).toHaveLength(1);
    expect(readSubscription().lastVideoLink).toBe(mainUrl);
    expect(readSubscription().lastShortVideoLink).toBe(oldShortUrl);

    vi.mocked(YtDlpDownloader.getLatestShortsUrl).mockResolvedValue(shortUrl);
    vi.mocked(downloadService.downloadYouTubeVideo).mockRejectedValue(membersOnly);
    await check();
    expect(getVideoRetry("sub", shortUrl)).toBeUndefined();
    expect(history(shortUrl)).toHaveLength(1);
    expect(readSubscription().lastShortVideoLink).toBe(shortUrl);
  });

  it("counts a saved Short even when writing its success history throws", async () => {
    vi.mocked(storageService.addDownloadHistoryItem).mockImplementationOnce(() => {
      throw new Error("history write failed");
    });
    await check();
    expect(readSubscription().downloadCount).toBe(6);
    expect(readSubscription().lastCheckStatus).toBe("fail");
    expect(getVideoRetry("sub", shortUrl)).toBeDefined();
    await check();
    expect(getVideoRetry("sub", shortUrl)).toBeUndefined();
    expect(readSubscription().downloadCount).toBe(6);
    expect(attempts(shortUrl)).toHaveLength(1);
  });
});
