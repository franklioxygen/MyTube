import { describe, expect, it } from "vitest";
import { computeAliases } from "../../../services/filenameTemplate/aliases";
import { FilenameTemplateContext } from "../../../services/filenameTemplate/types";

function makeCtx(overrides: Partial<FilenameTemplateContext> = {}): FilenameTemplateContext {
  return {
    title: "Test",
    id: "x",
    ext: "mp4",
    uploader: "Author",
    channel: "Author",
    uploadDate: "20260430",
    uploadYear: "2026",
    uploadMonth: "04",
    uploadDay: "30",
    durationSeconds: 120,
    durationString: "02-00",
    artistName: "Author",
    sourceCustomName: "",
    sourceCollectionName: "Playlist",
    sourceCollectionId: "pl1",
    sourceCollectionType: "playlist",
    mediaPlaylistIndex: 3,
    platform: "youtube",
    sourceUrl: "https://youtube.com",
    ...overrides,
  };
}

describe("computeAliases", () => {
  it("season_from_date returns the upload year", () => {
    const aliases = computeAliases(makeCtx());
    expect(aliases.season_from_date).toBe("2026");
  });

  it("season_episode_from_date matches pattern s{year}e{mmdd}", () => {
    const aliases = computeAliases(makeCtx());
    expect(aliases.season_episode_from_date).toBe("s2026e0430");
  });

  it("season_episode_index_from_date appends zero-padded index", () => {
    const aliases = computeAliases(makeCtx({ mediaPlaylistIndex: 7 }));
    expect(aliases.season_episode_index_from_date).toBe("s2026e043007");
  });

  it("season_by_year__episode_by_date contains / for subdirectory", () => {
    const aliases = computeAliases(makeCtx());
    expect(aliases.season_by_year__episode_by_date).toBe("Season 2026/s2026e0430");
  });

  it("season_by_year__episode_by_date_and_index appends padded index", () => {
    const aliases = computeAliases(makeCtx({ mediaPlaylistIndex: 1 }));
    expect(aliases.season_by_year__episode_by_date_and_index).toBe("Season 2026/s2026e043001");
  });

  it("static_season__episode_by_index uses fixed Season 1 with padded index", () => {
    const aliases = computeAliases(makeCtx({ mediaPlaylistIndex: 12 }));
    expect(aliases.static_season__episode_by_index).toBe("Season 1/s01e12");
  });

  it("static_season__episode_by_date uses fixed Season 1 with date", () => {
    const aliases = computeAliases(makeCtx());
    expect(aliases.static_season__episode_by_date).toBe("Season 1/s01e20260430");
  });

  it("uses 00 index when mediaPlaylistIndex is undefined", () => {
    const aliases = computeAliases(makeCtx({ mediaPlaylistIndex: undefined }));
    expect(aliases.season_episode_index_from_date).toBe("s2026e043000");
    expect(aliases.static_season__episode_by_index).toBe("Season 1/s01e00");
  });
});
