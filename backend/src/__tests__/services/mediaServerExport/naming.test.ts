import { describe, expect, it } from "vitest";

import {
  buildExportStem,
  padEpisodeNumber,
  padSeasonNumber,
  retokenizeExportStem,
  sanitizeMirrorSegment,
} from "../../../services/mediaServerExport/naming";

/**
 * These rules shape real paths, so their edges are contracts: a stem that no
 * longer parses must not be silently half-rewritten, and arbitrary metadata
 * must never become a path segment.
 */
describe("mediaServerExport naming", () => {
  describe("sanitizeMirrorSegment", () => {
    it("refuses to turn a non-string into a path segment", () => {
      expect(sanitizeMirrorSegment(undefined as unknown as string)).toBe("");
      expect(sanitizeMirrorSegment(null as unknown as string)).toBe("");
      expect(sanitizeMirrorSegment(42 as unknown as string)).toBe("");
    });

    it("strips separators and traversal rather than escaping the segment", () => {
      const value = sanitizeMirrorSegment("../../etc/passwd");

      expect(value).not.toContain("..");
      expect(value).not.toContain("/");
      expect(value).not.toContain("\\");
    });
  });

  describe("padding", () => {
    it("pads as a minimum, never a truncation", () => {
      expect(padSeasonNumber(1)).toBe("01");
      expect(padSeasonNumber(123)).toBe("123");
      expect(padEpisodeNumber(1)).toBe("001");
      expect(padEpisodeNumber(1000)).toBe("1000");
    });
  });

  describe("retokenizeExportStem", () => {
    it("rewrites only the season token, keeping the title verbatim", () => {
      expect(retokenizeExportStem("S03E012 - The Egg", 1, 12)).toBe(
        "S01E012 - The Egg"
      );
    });

    it("keeps a de-duplication suffix the planner depends on", () => {
      expect(retokenizeExportStem("S02E001 - Title (2)", 1, 1)).toBe(
        "S01E001 - Title (2)"
      );
    });

    it("handles a stem that carries no title at all", () => {
      expect(retokenizeExportStem("S02E001", 1, 1)).toBe("S01E001");
    });

    it("is a no-op when the season is unchanged", () => {
      // This is what keeps mirror filenames identical across a move.
      expect(retokenizeExportStem("S01E001 - Ants", 1, 1)).toBe("S01E001 - Ants");
    });

    it("returns undefined for a stem it cannot parse, rather than guessing", () => {
      // The caller then builds a fresh stem instead of emitting a mangled one.
      expect(retokenizeExportStem("not-a-stem", 1, 1)).toBeUndefined();
      expect(retokenizeExportStem("", 1, 1)).toBeUndefined();
      expect(retokenizeExportStem("Season 1 Episode 1", 1, 1)).toBeUndefined();
    });
  });

  describe("buildExportStem", () => {
    it("omits the separator when the title sanitizes away entirely", () => {
      expect(buildExportStem(1, 1, '   ?<>|   ')).toBe("S01E001");
    });
  });
});
