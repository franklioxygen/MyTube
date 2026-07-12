import { describe, expect, it } from "vitest";
import { countTagUsage, normalizeTagKey, sortTagsByUsage } from "../tagUtils";

describe("normalizeTagKey", () => {
  it("trims and lowercases", () => {
    expect(normalizeTagKey("  Music ")).toBe("music");
  });

  it("returns empty string for nullish", () => {
    expect(normalizeTagKey(null)).toBe("");
    expect(normalizeTagKey(undefined)).toBe("");
  });
});

describe("countTagUsage", () => {
  it("counts case-insensitive matches against catalog casing", () => {
    const counts = countTagUsage(
      ["Music", "Tech"],
      [{ tags: ["music", "TECH"] }, { tags: ["Music"] }]
    );
    expect(counts.get("Music")).toBe(2);
    expect(counts.get("Tech")).toBe(1);
  });

  it("counts duplicate tags on one video only once", () => {
    const counts = countTagUsage(
      ["Music"],
      [{ tags: ["Music", "music", "MUSIC"] }]
    );
    expect(counts.get("Music")).toBe(1);
  });

  it("leaves unused catalog tags at zero", () => {
    const counts = countTagUsage(["A", "B"], [{ tags: ["A"] }]);
    expect(counts.get("A")).toBe(1);
    expect(counts.get("B")).toBe(0);
  });

  it("ignores orphan video tags not in the catalog", () => {
    const counts = countTagUsage(["A"], [{ tags: ["orphan", "A"] }]);
    expect(counts.size).toBe(1);
    expect(counts.get("A")).toBe(1);
  });
});

describe("sortTagsByUsage", () => {
  it("orders by descending usage then alphabetical", () => {
    const sorted = sortTagsByUsage(
      ["Zebra", "Apple", "Music", "Banana"],
      [
        { tags: ["Music"] },
        { tags: ["Music", "Apple"] },
        { tags: ["Banana"] },
      ]
    );
    expect(sorted).toEqual(["Music", "Apple", "Banana", "Zebra"]);
  });

  it("returns empty array for empty catalog", () => {
    expect(sortTagsByUsage([], [{ tags: ["x"] }])).toEqual([]);
  });

  it("keeps catalog order stable when all unused (alphabetical)", () => {
    expect(sortTagsByUsage(["b", "a", "c"], [])).toEqual(["a", "b", "c"]);
  });
});
