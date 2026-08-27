import { describe, expect, it } from "vitest";
import {
  isConfidentTMDBTitleMatch,
  isHighConfidenceTMDBTitleMatch,
} from "../../../services/tmdbService/titleMatch";

/**
 * The strict gate used when marking a collection as its own show. A wrong match
 * allocates an immutable show directory, so the bar is higher than the scan
 * flow's.
 */
describe("isHighConfidenceTMDBTitleMatch", () => {
  describe("accepts", () => {
    it("an exact match", () => {
      expect(
        isHighConfidenceTMDBTitleMatch("人民的名义", { name: "人民的名义" })
      ).toBe(true);
    });

    it("a match differing only in separators or case", () => {
      expect(
        isHighConfidenceTMDBTitleMatch("the.matrix", { title: "The Matrix" })
      ).toBe(true);
    });

    it("a collapsed match differing only in spacing", () => {
      expect(
        isHighConfidenceTMDBTitleMatch("人民 的 名义", { name: "人民的名义" })
      ).toBe(true);
    });

    it("a query whose tokens are all present in the candidate", () => {
      expect(
        isHighConfidenceTMDBTitleMatch("Matrix Reloaded", {
          title: "The Matrix Reloaded",
        })
      ).toBe(true);
    });

    it("a trailing year, which is not a comparable token", () => {
      expect(
        isHighConfidenceTMDBTitleMatch("The Matrix Reloaded 2003", {
          title: "The Matrix Reloaded",
        })
      ).toBe(true);
    });

    it("a match on any of the four candidate title fields", () => {
      for (const item of [
        { title: "The Matrix" },
        { original_title: "The Matrix" },
        { name: "The Matrix" },
        { original_name: "The Matrix" },
      ]) {
        expect(isHighConfidenceTMDBTitleMatch("The Matrix", item)).toBe(true);
      }
    });
  });

  describe("rejects", () => {
    /**
     * The case that motivates this function existing at all. The loose gate
     * accepts it; naming a Kurzgesagt show after an unrelated film would be
     * permanent.
     */
    it("a merely-two-shared-token overlap that the loose gate accepts", () => {
      const query = "How Many Ants Live On Earth";
      const decoy = { title: "How To Live On Mars" };

      expect(isConfidentTMDBTitleMatch(query, decoy)).toBe(true);
      expect(isHighConfidenceTMDBTitleMatch(query, decoy)).toBe(false);
    });

    it("substring containment, which the loose gate accepts", () => {
      // 《人民的名义》超高清版 must NOT strictly match 人民的名义; design §5.3
      // says the user searches again with the shorter title instead.
      const query = "人民的名义超高清版";
      const item = { name: "人民的名义" };

      expect(isConfidentTMDBTitleMatch(query, item)).toBe(true);
      expect(isHighConfidenceTMDBTitleMatch(query, item)).toBe(false);
    });

    it("a candidate shorter than the query, even as a clean subset", () => {
      // The query carries extra meaningful words: the user asked for the
      // special, TMDB returned the parent show. Different title.
      expect(
        isHighConfidenceTMDBTitleMatch("The Office Christmas Special", {
          title: "The Office",
        })
      ).toBe(false);
    });

    it("an unrelated title", () => {
      expect(
        isHighConfidenceTMDBTitleMatch("Kurzgesagt", { title: "The Matrix" })
      ).toBe(false);
    });

    it("a search title shorter than two characters", () => {
      expect(isHighConfidenceTMDBTitleMatch("a", { title: "a" })).toBe(false);
    });

    it("a result with no usable title field", () => {
      expect(isHighConfidenceTMDBTitleMatch("The Matrix", {})).toBe(false);
    });
  });

  it("leaves the scan-flow gate untouched", () => {
    // Same inputs, different verdicts, is the whole point. If these ever agree
    // on everything, one of them has been changed by mistake.
    const loose = isConfidentTMDBTitleMatch("Matrix Reloaded Extra", {
      title: "The Matrix Reloaded",
    });
    const strict = isHighConfidenceTMDBTitleMatch("Matrix Reloaded Extra", {
      title: "The Matrix Reloaded",
    });

    expect(loose).toBe(true);
    expect(strict).toBe(false);
  });
});
