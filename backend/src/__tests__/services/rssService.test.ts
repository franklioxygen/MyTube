/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import { ValidationError } from "../../errors/DownloadErrors";
import {
  buildRssXml,
  getVideosForRss,
  resetRssToken,
  validateAndNormalizeFilters,
  wrapCdata,
} from "../../services/rssService";

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

const baseToken = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  label: "A & B",
  role: "visitor" as const,
  filters: {},
  isActive: true,
  accessCount: 0,
  lastAccessedAt: null,
  createdAt: 1710000000000,
  updatedAt: 1710000000000,
};

function mockVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: "video-1",
    title: "Title <tag> & more",
    author: "Author <script>",
    source: "youtube",
    sourceUrl: "https://youtube.example/watch?v=1",
    channelUrl: "https://youtube.example/@author",
    tags: JSON.stringify(["alpha & beta", "plain"]),
    addedAt: "2026-04-20T10:00:00.000Z",
    createdAt: "2026-04-19T10:00:00.000Z",
    thumbnailPath: "/images/thumb.webp",
    thumbnailUrl: null,
    duration: "01:23",
    visibility: 1,
    ...overrides,
  } as any;
}

function mockSelectForVideos(rows: any[] = []) {
  const all = vi.fn().mockReturnValue(rows);
  const limit = vi.fn().mockReturnValue({ all });
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const dynamicBuilder = { where, orderBy };
  const from = vi.fn().mockReturnValue({
    $dynamic: vi.fn().mockReturnValue(dynamicBuilder),
  });

  vi.mocked(db.select).mockReturnValue({ from } as any);
  return { all, from, limit, orderBy, where };
}

describe("rssService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateAndNormalizeFilters", () => {
    it("normalizes empty strings and duplicates while preserving maxItems=1", () => {
      expect(
        validateAndNormalizeFilters({
          authors: ["Alice", " ", "Alice"],
          channelUrls: ["https://example.com/a", "https://example.com/a"],
          tags: ["news", ""],
          sources: ["youtube", "cloud"],
          dayRange: 7,
          maxItems: 1,
        })
      ).toEqual({
        authors: ["Alice"],
        channelUrls: ["https://example.com/a"],
        tags: ["news"],
        sources: ["youtube", "cloud"],
        dayRange: 7,
        maxItems: 1,
      });
    });

    it("rejects invalid filter values instead of silently dropping them", () => {
      expect(() =>
        validateAndNormalizeFilters({ channelUrls: ["ftp://example.com"] })
      ).toThrow(ValidationError);
      expect(() =>
        validateAndNormalizeFilters({ channelUrls: ["http://"] })
      ).toThrow(ValidationError);
      expect(() =>
        validateAndNormalizeFilters({ sources: ["unknown"] })
      ).toThrow(ValidationError);
      expect(() =>
        validateAndNormalizeFilters({ maxItems: 300 })
      ).toThrow(ValidationError);
      expect(() =>
        validateAndNormalizeFilters({ dayRange: 0 })
      ).toThrow(ValidationError);
    });
  });

  describe("buildRssXml", () => {
    it("escapes XML text, escapes description HTML, maps language, and emits thumbnail metadata", () => {
      const xml = buildRssXml([mockVideo()], baseToken, "https://mytube.example", {
        language: "zh",
      });

      expect(xml).toContain("<title>MyTube · A &amp; B</title>");
      expect(xml).toContain("<language>zh-cn</language>");
      expect(xml).toContain("<title>Title &lt;tag&gt; &amp; more</title>");
      expect(xml).toContain("<dc:creator>Author &lt;script&gt;</dc:creator>");
      expect(xml).toContain("<category>alpha &amp; beta</category>");
      expect(xml).toContain('src="https://mytube.example/images/thumb.webp"');
      expect(xml).toContain('type="image/webp"');
      expect(xml).toContain("Author &lt;script&gt;");
      expect(xml).not.toContain("<script>");
    });

    it("splits CDATA terminators so descriptions stay valid XML", () => {
      expect(wrapCdata("bad ]]> content")).toBe("<![CDATA[bad ]]]]><![CDATA[> content]]>");
    });

    it("omits media elements when a thumbnail URL cannot be built", () => {
      const xml = buildRssXml(
        [mockVideo({ thumbnailPath: null, thumbnailUrl: null })],
        baseToken,
        "https://mytube.example"
      );

      expect(xml).not.toContain("<media:thumbnail");
      expect(xml).not.toContain("<media:content");
      expect(xml).not.toContain("<img ");
    });
  });

  describe("getVideosForRss", () => {
    it("applies SQL filters before limit so tags plus maxItems cannot drop later matches", async () => {
      const query = mockSelectForVideos([mockVideo()]);

      const rows = await getVideosForRss({ tags: ["match"], maxItems: 1 }, "visitor");

      expect(rows).toHaveLength(1);
      expect(query.where).toHaveBeenCalledTimes(1);
      expect(query.limit).toHaveBeenCalledWith(1);
      expect(query.where.mock.invocationCallOrder[0]).toBeLessThan(
        query.orderBy.mock.invocationCallOrder[0]
      );
      expect(query.orderBy.mock.invocationCallOrder[0]).toBeLessThan(
        query.limit.mock.invocationCallOrder[0]
      );
    });
  });

  describe("resetRssToken", () => {
    it("rotates the id atomically while preserving active state and clearing access stats", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1711000000000);

      let inserted: any;
      let selectCount = 0;
      const oldRow = {
        id: "old-token",
        label: "Private",
        role: "admin",
        filters: JSON.stringify({ maxItems: 10 }),
        isActive: 0,
        accessCount: 42,
        lastAccessedAt: 1710000000000,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };

      vi.mocked(db.transaction).mockImplementation(((fn: () => unknown) => fn()) as any);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn(() => {
              selectCount += 1;
              if (selectCount === 1) return oldRow;
              return {
                ...oldRow,
                id: inserted.id,
                accessCount: inserted.accessCount,
                lastAccessedAt: inserted.lastAccessedAt,
                createdAt: inserted.createdAt,
                updatedAt: inserted.updatedAt,
              };
            }),
          }),
        }),
      } as any);
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn((values) => {
          inserted = values;
          return { run: vi.fn() };
        }),
      } as any);
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockReturnValue({ run: vi.fn() }),
      } as any);

      const result = await resetRssToken("old-token");

      expect(result?.oldId).toBe("old-token");
      expect(result?.token.id).not.toBe("old-token");
      expect(result?.token.isActive).toBe(false);
      expect(result?.token.accessCount).toBe(0);
      expect(result?.token.lastAccessedAt).toBeNull();
      expect(result?.token.createdAt).toBe(1711000000000);
      expect(inserted).toEqual(
        expect.objectContaining({
          label: "Private",
          role: "admin",
          filters: JSON.stringify({ maxItems: 10 }),
          isActive: 0,
          accessCount: 0,
          lastAccessedAt: null,
          createdAt: 1711000000000,
          updatedAt: 1711000000000,
        })
      );
    });
  });
});
