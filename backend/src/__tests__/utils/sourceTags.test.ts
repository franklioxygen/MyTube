import { describe, expect, it } from "vitest";
import {
  isValidAutoTagList,
  MAX_AUTO_TAGS,
  MAX_TAG_ALIASES,
  normalizeSourceTags,
  normalizeTagAliases,
} from "../../utils/sourceTags";

describe("normalizeSourceTags", () => {
  it("returns nothing for a missing or non-array value", () => {
    expect(normalizeSourceTags(undefined)).toEqual([]);
    expect(normalizeSourceTags(null)).toEqual([]);
    expect(normalizeSourceTags("music")).toEqual([]);
  });

  it("trims, strips leading #, collapses whitespace and drops junk entries", () => {
    expect(
      normalizeSourceTags(["  #Music ", "##live", "lo   fi", "", "   ", 3, null, "x".repeat(65)])
    ).toEqual(["Music", "live", "lo fi"]);
  });

  it("dedupes ignoring case and keeps source order", () => {
    expect(normalizeSourceTags(["B", "a", "b", "A", "c"])).toEqual(["B", "a", "c"]);
  });

  it("reuses the catalog spelling for an existing tag", () => {
    expect(
      normalizeSourceTags(["music", "LIVE"], { catalog: ["Music", "Live"] })
    ).toEqual(["Music", "Live"]);
  });

  it("skips tags the video already carries", () => {
    expect(
      normalizeSourceTags(["music", "live"], { manualTags: ["Music"] })
    ).toEqual(["live"]);
  });

  it("caps the list", () => {
    const raw = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    const result = normalizeSourceTags(raw);
    expect(result).toHaveLength(MAX_AUTO_TAGS);
    expect(result[0]).toBe("tag0");
  });

  it("keeps the source spelling when the catalog spelling is too long", () => {
    // "İ" lowercases to two code units, so this 65-unit catalog entry shares
    // a key with the 33-unit source tag.
    const source = "İ".repeat(32) + "x";
    const catalogEntry = "i\u0307".repeat(32) + "x";
    expect(catalogEntry.toLowerCase()).toBe(source.toLowerCase());
    const result = normalizeSourceTags([source], { catalog: [catalogEntry] });
    expect(result).toEqual([source]);
    expect(isValidAutoTagList(result)).toBe(true);
  });
});

describe("normalizeSourceTags with aliases", () => {
  it("folds aliases into their canonical tag, spelled like the catalog", () => {
    expect(
      normalizeSourceTags(["#Song", "musique", "live"], {
        aliases: { song: "music", musique: "Music" },
        catalog: ["Music"],
      })
    ).toEqual(["Music", "live"]);
  });

  it("drops an aliased tag the video already has", () => {
    expect(
      normalizeSourceTags(["song", "live"], {
        aliases: { song: "音乐" },
        manualTags: ["音乐"],
      })
    ).toEqual(["live"]);
  });

  it("ignores alias targets that could not be stored", () => {
    expect(
      normalizeSourceTags(["song"], { aliases: { song: "x".repeat(65) } })
    ).toEqual(["song"]);
  });
});

describe("normalizeTagAliases", () => {
  it("cleans and lowercases aliases and cleans their tags", () => {
    expect(normalizeTagAliases({ " #Song ": "  Music ", Musique: "Music" })).toEqual({
      song: "Music",
      musique: "Music",
    });
  });

  it("rejects malformed maps", () => {
    expect(() => normalizeTagAliases(null)).toThrow();
    expect(() => normalizeTagAliases(["song"])).toThrow();
    expect(() => normalizeTagAliases({ song: 1 })).toThrow();
    expect(() => normalizeTagAliases({ song: " " })).toThrow();
    expect(() => normalizeTagAliases({ ["x".repeat(65)]: "music" })).toThrow();
  });

  it("rejects self-maps, duplicate aliases and chains", () => {
    expect(() => normalizeTagAliases({ music: "Music" })).toThrow(/itself/);
    expect(() => normalizeTagAliases({ Song: "music", song: "audio" })).toThrow(/twice/);
    expect(() => normalizeTagAliases({ song: "music", music: "音乐" })).toThrow(/itself an alias/);
  });

  it("caps the number of aliases", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_TAG_ALIASES + 1 }, (_, i) => [`a${i}`, "music"])
    );
    expect(() => normalizeTagAliases(tooMany)).toThrow(/500/);
  });
});

describe("isValidAutoTagList", () => {
  it("accepts an empty list and short strings", () => {
    expect(isValidAutoTagList([])).toBe(true);
    expect(isValidAutoTagList(["live", "音乐"])).toBe(true);
  });

  it("rejects non-arrays, non-strings, blanks, long values and long lists", () => {
    expect(isValidAutoTagList("live")).toBe(false);
    expect(isValidAutoTagList([1])).toBe(false);
    expect(isValidAutoTagList([" "])).toBe(false);
    expect(isValidAutoTagList(["x".repeat(65)])).toBe(false);
    expect(isValidAutoTagList(Array.from({ length: 21 }, (_, i) => `t${i}`))).toBe(false);
  });
});
