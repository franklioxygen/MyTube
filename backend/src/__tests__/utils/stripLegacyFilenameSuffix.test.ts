import { describe, expect, it } from "vitest";
import {
  formatVideoFilename,
  stripLegacyFilenameSuffix,
} from "../../utils/helpers";

describe("stripLegacyFilenameSuffix", () => {
  it("strips a matching -Author-Year suffix", () => {
    const result = stripLegacyFilenameSuffix(
      "My Title-Yajunchannel-2026",
      "Yajunchannel",
      "20260101"
    );
    expect(result).toBe("My Title");
  });

  it("strips a matching -Author-Year_N dedupe suffix", () => {
    const result = stripLegacyFilenameSuffix(
      "My Title-Yajunchannel-2026_3",
      "Yajunchannel",
      "20260101"
    );
    expect(result).toBe("My Title");
  });

  it("strips when author has spaces (matches cleaned form)", () => {
    // "Some Channel" cleans to "Some.Channel"
    const result = stripLegacyFilenameSuffix(
      "X-Some.Channel-2024",
      "Some Channel",
      "20240101"
    );
    expect(result).toBe("X");
  });

  it("does NOT strip when author segment is different from record's author", () => {
    const result = stripLegacyFilenameSuffix(
      "X-OtherAuthor-2026",
      "Yajunchannel",
      "20260101"
    );
    expect(result).toBe("X-OtherAuthor-2026");
  });

  it("does NOT strip when year is different from record's year", () => {
    const result = stripLegacyFilenameSuffix(
      "X-Yajunchannel-2024",
      "Yajunchannel",
      "20260101"
    );
    expect(result).toBe("X-Yajunchannel-2024");
  });

  it("does NOT strip when title has no matching suffix", () => {
    const result = stripLegacyFilenameSuffix(
      "Just A Title",
      "Yajunchannel",
      "20260101"
    );
    expect(result).toBe("Just A Title");
  });

  it("returns title unchanged when author is missing", () => {
    expect(
      stripLegacyFilenameSuffix("X-A-2026", undefined, "20260101")
    ).toBe("X-A-2026");
  });

  it("returns title unchanged when date is missing", () => {
    expect(
      stripLegacyFilenameSuffix("X-A-2026", "A", undefined)
    ).toBe("X-A-2026");
  });

  it("returns title unchanged when date has no 4-digit year", () => {
    expect(
      stripLegacyFilenameSuffix("X-A-2026", "A", "no-year-here")
    ).toBe("X-A-2026");
  });

  it("returns empty string for undefined title", () => {
    expect(
      stripLegacyFilenameSuffix(undefined, "A", "20260101")
    ).toBe("");
  });

  it("does not strip when author cleans to 'Unknown'", () => {
    // empty/symbol-only author cleans to "Unknown" — too generic to match safely
    const result = stripLegacyFilenameSuffix(
      "X-Unknown-2026",
      "",
      "20260101"
    );
    expect(result).toBe("X-Unknown-2026");
  });

  it("is idempotent: applying twice yields the same result", () => {
    const once = stripLegacyFilenameSuffix(
      "My Title-Yajunchannel-2026",
      "Yajunchannel",
      "20260101"
    );
    const twice = stripLegacyFilenameSuffix(
      once,
      "Yajunchannel",
      "20260101"
    );
    expect(twice).toBe(once);
  });

  it("handles CJK titles correctly", () => {
    // Reported user case: 万元房租一分不退维权反被骂-Yajunchannel-2026
    const result = stripLegacyFilenameSuffix(
      "万元房租一分不退维权反被骂-Yajunchannel-2026",
      "Yajunchannel",
      "20260101"
    );
    expect(result).toBe("万元房租一分不退维权反被骂");
  });

  it("round-trips byte-identical for CJK titles (user's reported case)", () => {
    // For titles without ASCII punctuation/spaces (e.g. CJK), the strip +
    // re-format loop produces the original filename byte-identically.
    const original = "万元房租一分不退维权反被骂";
    const formatted = formatVideoFilename(original, "Yajunchannel", "20260101");
    expect(formatted).toBe("万元房租一分不退维权反被骂-Yajunchannel-2026");
    const stripped = stripLegacyFilenameSuffix(
      formatted,
      "Yajunchannel",
      "20260101"
    );
    expect(stripped).toBe(original);
    expect(
      formatVideoFilename(stripped, "Yajunchannel", "20260101")
    ).toBe(formatted);
  });

  it("partially recovers ASCII titles with spaces (best-effort)", () => {
    // formatVideoFilename converts spaces to dots and then strips dots on
    // re-application, so for ASCII titles with spaces the strip recovers
    // a title without the spaces. The result is still much better than the
    // unrepaired "TitleAuthor2026-Author-2026" garble — the spurious
    // duplicated suffix is removed.
    const formatted = formatVideoFilename("Some Title", "Author", "20260101");
    const stripped = stripLegacyFilenameSuffix(formatted, "Author", "20260101");
    expect(stripped).toBe("Some.Title");
    // Re-formatting goes through format()'s cleanSegment which strips the dot.
    // The fix removes the duplicate-suffix bug; full byte-identity for
    // space-containing ASCII titles requires the schema change in §24.5.
    expect(
      formatVideoFilename(stripped, "Author", "20260101")
    ).toBe("SomeTitle-Author-2026");
  });
});
