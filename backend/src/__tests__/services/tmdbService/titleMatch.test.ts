import { describe, expect, it } from "vitest";
import { isConfidentTMDBTitleMatch } from "../../../services/tmdbService/titleMatch";

/**
 * Regression boundary for the collection-as-show work.
 *
 * The scan flow relies on this gate being deliberately loose: filenames imported
 * by a local scan are already close to a real title, so a two-shared-token match
 * is usually right there. The collection-show feature adds a *separate*, stricter
 * predicate rather than tightening this one — these tests exist so a later change
 * cannot quietly alter scan behavior.
 */
describe("isConfidentTMDBTitleMatch (scan-flow gate, frozen)", () => {
  it("accepts an exact title match", () => {
    expect(
      isConfidentTMDBTitleMatch("The Matrix", { title: "The Matrix" })
    ).toBe(true);
  });

  it("accepts a match on any of the four candidate title fields", () => {
    expect(isConfidentTMDBTitleMatch("人民的名义", { name: "人民的名义" })).toBe(
      true
    );
    expect(
      isConfidentTMDBTitleMatch("In the Name of People", {
        original_name: "In the Name of People",
      })
    ).toBe(true);
    expect(
      isConfidentTMDBTitleMatch("The Matrix", { original_title: "The Matrix" })
    ).toBe(true);
  });

  it("ignores separators and case when comparing", () => {
    expect(
      isConfidentTMDBTitleMatch("the.matrix", { title: "The Matrix" })
    ).toBe(true);
    expect(
      isConfidentTMDBTitleMatch("The_Matrix-1999", { title: "the matrix 1999" })
    ).toBe(true);
  });

  it("accepts a substring relationship once both sides are long enough", () => {
    expect(
      isConfidentTMDBTitleMatch("Matrix", { title: "The Matrix Reloaded" })
    ).toBe(true);
  });

  it("accepts a full token subset", () => {
    expect(
      isConfidentTMDBTitleMatch("Matrix Reloaded", {
        title: "The Matrix Reloaded",
      })
    ).toBe(true);
  });

  /**
   * The loose rule the collection-show gate deliberately does NOT inherit: two
   * shared tokens are enough here, which is wrong for arbitrary YouTube titles.
   */
  it("accepts merely two shared tokens — the looseness that is not inherited", () => {
    expect(
      isConfidentTMDBTitleMatch("How Many Ants Live On Earth", {
        title: "How To Live On Mars",
      })
    ).toBe(true);
  });

  it("rejects a search title shorter than two characters", () => {
    expect(isConfidentTMDBTitleMatch("a", { title: "a" })).toBe(false);
  });

  it("rejects an unrelated title", () => {
    expect(
      isConfidentTMDBTitleMatch("Kurzgesagt", { title: "The Matrix" })
    ).toBe(false);
  });

  it("rejects when the result carries no usable title field", () => {
    expect(isConfidentTMDBTitleMatch("The Matrix", {})).toBe(false);
  });
});
