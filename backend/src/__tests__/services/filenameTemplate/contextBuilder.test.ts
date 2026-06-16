import { describe, expect, it } from "vitest";
import {
  buildContextFromBilibiliMetadata,
  buildContextFromVideoRecord,
  buildContextFromYtDlpInfo,
} from "../../../services/filenameTemplate/contextBuilder";
import { Video } from "../../../services/storageService/types";

describe("buildContextFromYtDlpInfo", () => {
  const baseInfo = {
    title: "Test Video",
    id: "yt123",
    uploader: "Test Channel",
    channel: "Test Channel",
    upload_date: "20260430",
    extractor: "youtube",
    duration: 300,
  };

  it("extracts basic fields", () => {
    const ctx = buildContextFromYtDlpInfo("https://www.youtube.com/watch?v=yt123", baseInfo);
    expect(ctx.title).toBe("Test Video");
    expect(ctx.id).toBe("yt123");
    expect(ctx.uploader).toBe("Test Channel");
    expect(ctx.sourceCustomName).toBe("Test Channel");
    expect(ctx.uploadDate).toBe("20260430");
    expect(ctx.uploadYear).toBe("2026");
    expect(ctx.uploadMonth).toBe("04");
    expect(ctx.uploadDay).toBe("30");
    expect(ctx.platform).toBe("youtube");
  });

  it("formats duration correctly", () => {
    const ctx = buildContextFromYtDlpInfo("https://youtu.be/x", { ...baseInfo, duration: 3661 });
    expect(ctx.durationString).toBe("01-01-01");
  });

  it("falls back to today when upload_date is missing", () => {
    const ctx = buildContextFromYtDlpInfo("https://youtu.be/x", { ...baseInfo, upload_date: undefined });
    expect(ctx.uploadYear).toBeTruthy();
    expect(ctx.uploadYear.length).toBe(4);
  });

  it("applies sourceCollectionName from options", () => {
    const ctx = buildContextFromYtDlpInfo(
      "https://youtu.be/x",
      baseInfo,
      {
        sourceCustomName: "Pinned Source Name",
        sourceCollectionName: "My Playlist",
        sourceCollectionType: "playlist",
      }
    );
    expect(ctx.sourceCustomName).toBe("Pinned Source Name");
    expect(ctx.sourceCollectionName).toBe("My Playlist");
    expect(ctx.sourceCollectionType).toBe("playlist");
  });

  it("falls back to playlist info from info object", () => {
    const infoWithPlaylist = { ...baseInfo, playlist_title: "Auto Playlist", playlist_index: 5 };
    const ctx = buildContextFromYtDlpInfo("https://youtu.be/x", infoWithPlaylist);
    expect(ctx.sourceCollectionName).toBe("Auto Playlist");
    expect(ctx.mediaPlaylistIndex).toBe(5);
  });

  it("detects bilibili platform from extractor", () => {
    const biliInfo = { ...baseInfo, extractor: "bilibili" };
    const ctx = buildContextFromYtDlpInfo("https://www.bilibili.com/video/BV1", biliInfo, {});
    expect(ctx.platform).toBe("bilibili");
  });
});

describe("buildContextFromBilibiliMetadata", () => {
  const bilibilMeta = {
    title: "Bilibili Video",
    bvid: "BV1abc",
    owner: { name: "BiliUser" },
    pubdate: 1777497600, // 2026-04-30 00:00 UTC
    duration: 120,
  };

  it("extracts title and uploader", () => {
    const ctx = buildContextFromBilibiliMetadata("https://www.bilibili.com/video/BV1abc", bilibilMeta);
    expect(ctx.title).toBe("Bilibili Video");
    expect(ctx.uploader).toBe("BiliUser");
    expect(ctx.sourceCustomName).toBe("BiliUser");
    expect(ctx.id).toBe("BV1abc");
    expect(ctx.platform).toBe("bilibili");
  });

  it("converts pubdate unix timestamp to upload date", () => {
    const ctx = buildContextFromBilibiliMetadata("https://www.bilibili.com/video/BV1abc", bilibilMeta);
    // pubdate 1745971200 = 2026-04-30 in UTC
    expect(ctx.uploadYear).toBe("2026");
    expect(ctx.uploadMonth).toBe("04");
  });

  it("applies source options", () => {
    const ctx = buildContextFromBilibiliMetadata(
      "https://www.bilibili.com/video/BV1abc",
      bilibilMeta,
      { sourceCollectionName: "Series Name", sourceCollectionType: "playlist" }
    );
    expect(ctx.sourceCollectionName).toBe("Series Name");
  });
});

describe("buildContextFromVideoRecord", () => {
  const video: Video = {
    id: "vid1",
    title: "Stored Video",
    author: "Stored Author",
    date: "20260315",
    source: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=vid1",
    videoFilename: "video.mp4",
    addedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  it("builds context from video record", () => {
    const ctx = buildContextFromVideoRecord(video);
    expect(ctx.title).toBe("Stored Video");
    expect(ctx.uploader).toBe("Stored Author");
    expect(ctx.sourceCustomName).toBe("Stored Author");
    expect(ctx.uploadYear).toBe("2026");
    expect(ctx.uploadMonth).toBe("03");
    expect(ctx.uploadDay).toBe("15");
    expect(ctx.platform).toBe("youtube");
  });

  it("applies overriding options", () => {
    const ctx = buildContextFromVideoRecord(video, {
      sourceCollectionName: "Collection",
      mediaPlaylistIndex: 7,
    });
    expect(ctx.sourceCollectionName).toBe("Collection");
    expect(ctx.mediaPlaylistIndex).toBe(7);
  });
});

describe("extractPlatform — URL hostname safety (CodeQL js/incomplete-url-substring-sanitization)", () => {
  it("classifies a real youtube URL as youtube", () => {
    const ctx = buildContextFromYtDlpInfo(
      "https://www.youtube.com/watch?v=abc",
      { title: "T", id: "x", upload_date: "20260101" }
    );
    expect(ctx.platform).toBe("youtube");
  });

  it("classifies youtu.be as youtube", () => {
    const ctx = buildContextFromYtDlpInfo(
      "https://youtu.be/abc",
      { title: "T", id: "x", upload_date: "20260101" }
    );
    expect(ctx.platform).toBe("youtube");
  });

  it("rejects an attacker URL with youtube.com in path", () => {
    const ctx = buildContextFromYtDlpInfo(
      "https://evil.com/path?next=youtube.com",
      { title: "T", id: "x", upload_date: "20260101" }
    );
    // Without source hint and with non-matching hostname, should NOT be youtube.
    expect(ctx.platform).not.toBe("youtube");
  });

  it("rejects an attacker URL with bilibili.com prefix in path", () => {
    const ctx = buildContextFromYtDlpInfo(
      "https://evil.com/bilibili.com",
      { title: "T", id: "x", upload_date: "20260101" }
    );
    expect(ctx.platform).not.toBe("bilibili");
  });

  it("rejects a url like 'foo.youtube.com.evil.tld'", () => {
    const ctx = buildContextFromYtDlpInfo(
      "https://foo.youtube.com.evil.tld/x",
      { title: "T", id: "x", upload_date: "20260101" }
    );
    expect(ctx.platform).not.toBe("youtube");
  });

  it("classifies a subdomain like m.youtube.com as youtube", () => {
    const ctx = buildContextFromYtDlpInfo(
      "https://m.youtube.com/watch?v=x",
      { title: "T", id: "x", upload_date: "20260101" }
    );
    expect(ctx.platform).toBe("youtube");
  });

  it("returns unknown for an unparseable URL", () => {
    const ctx = buildContextFromYtDlpInfo("not a url", {
      title: "T",
      id: "x",
      upload_date: "20260101",
    });
    expect(ctx.platform).toBe("unknown");
  });

  it("source hint still wins when URL hostname does not match", () => {
    const ctx = buildContextFromYtDlpInfo(
      "https://example.com/x",
      {
        title: "T",
        id: "x",
        upload_date: "20260101",
        extractor: "youtube",
      }
    );
    expect(ctx.platform).toBe("youtube");
  });
});
