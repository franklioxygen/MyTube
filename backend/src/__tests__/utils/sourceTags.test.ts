import { describe, expect, it } from "vitest";
import {
  isValidAutoTagList,
  MAX_AUTO_TAGS,
  normalizeSourceTags,
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
