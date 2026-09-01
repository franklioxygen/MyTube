import { describe, expect, it } from "vitest";
import {
  GESTURE_DOT_COUNT,
  appendDot,
  canonicalizePattern,
  getMidpoint,
  toCanonicalMaterial,
} from "../gesturePattern";

/**
 * These fixtures are shared verbatim by the backend and frontend copies of
 * gesturePattern.ts. If one side is edited, both suites must still pass -
 * that is the point of duplicating them.
 */

/** The eight undirected collinear pairs, exactly as specified in the design. */
const EXPECTED_MIDPOINT_PAIRS: ReadonlyArray<[number, number, number]> = [
  [0, 2, 1],
  [0, 6, 3],
  [2, 8, 5],
  [6, 8, 7],
  [0, 8, 4],
  [2, 6, 4],
  [1, 7, 4],
  [3, 5, 4],
];

describe("getMidpoint", () => {
  it("returns the crossed dot for all eight pairs in both directions", () => {
    for (const [from, to, midpoint] of EXPECTED_MIDPOINT_PAIRS) {
      expect(getMidpoint(from, to)).toBe(midpoint);
      expect(getMidpoint(to, from)).toBe(midpoint);
    }
  });

  it("finds no other midpoint anywhere on the grid", () => {
    const expected = new Set(
      EXPECTED_MIDPOINT_PAIRS.flatMap(([from, to]) => [
        `${from}-${to}`,
        `${to}-${from}`,
      ])
    );

    const actual = new Set<string>();
    for (let from = 0; from < GESTURE_DOT_COUNT; from += 1) {
      for (let to = 0; to < GESTURE_DOT_COUNT; to += 1) {
        if (getMidpoint(from, to) !== null) {
          actual.add(`${from}-${to}`);
        }
      }
    }

    expect(actual).toEqual(expected);
  });

  it("returns null for adjacent moves, knight moves, and invalid dots", () => {
    expect(getMidpoint(0, 1)).toBeNull();
    expect(getMidpoint(0, 3)).toBeNull();
    expect(getMidpoint(0, 4)).toBeNull();
    expect(getMidpoint(1, 3)).toBeNull();
    expect(getMidpoint(0, 5)).toBeNull();
    expect(getMidpoint(3, 8)).toBeNull();
    expect(getMidpoint(0, 0)).toBeNull();
    expect(getMidpoint(-1, 2)).toBeNull();
    expect(getMidpoint(0, 9)).toBeNull();
  });
});

describe("canonicalizePattern", () => {
  it("inserts a skipped midpoint, which can carry a two-dot draw to validity", () => {
    const result = canonicalizePattern([0, 2]);

    expect(result).toEqual({
      ok: true,
      pattern: [0, 1, 2],
      material: "gesture-v1:0.1.2",
    });
  });

  it("leaves an already-adjacent sequence untouched", () => {
    expect(canonicalizePattern([0, 1, 2])).toEqual({
      ok: true,
      pattern: [0, 1, 2],
      material: "gesture-v1:0.1.2",
    });
  });

  it("inserts a midpoint on every segment, not only the first", () => {
    // 0 -> 8 crosses 4; 8 -> 2 then crosses the still-unselected 5.
    expect(canonicalizePattern([0, 8, 2])).toEqual({
      ok: true,
      pattern: [0, 4, 8, 5, 2],
      material: "gesture-v1:0.4.8.5.2",
    });
  });

  it("does not reinsert a midpoint that is already selected", () => {
    // 0 -> 8 would cross 4, but 4 was consumed as the opening dot.
    expect(canonicalizePattern([4, 0, 8])).toEqual({
      ok: true,
      pattern: [4, 0, 8],
      material: "gesture-v1:4.0.8",
    });
  });

  it("accepts a full nine-dot pattern", () => {
    const result = canonicalizePattern([0, 1, 2, 5, 4, 3, 6, 7, 8]);

    expect(result.ok).toBe(true);
    expect(result.ok && result.pattern).toEqual([0, 1, 2, 5, 4, 3, 6, 7, 8]);
  });

  it("rejects a canonical length below three", () => {
    expect(canonicalizePattern([0, 4])).toEqual({
      ok: false,
      error: "too_short",
    });
    expect(canonicalizePattern([0])).toEqual({ ok: false, error: "too_short" });
    expect(canonicalizePattern([])).toEqual({ ok: false, error: "too_short" });
  });

  it("rejects duplicate raw dots", () => {
    expect(canonicalizePattern([0, 1, 0])).toEqual({
      ok: false,
      error: "duplicate_dot",
    });
  });

  it("rejects a raw dot that a midpoint insertion already consumed", () => {
    // A real stroke cannot produce this: after 0 -> 2 auto-selects 1,
    // re-entering 1 does nothing. Only a custom client can send it, and
    // accepting it would give one gesture two wire representations.
    expect(canonicalizePattern([0, 2, 1])).toEqual({
      ok: false,
      error: "duplicate_dot",
    });
  });

  it("rejects out-of-range and non-integer dots", () => {
    expect(canonicalizePattern([0, 9, 1])).toEqual({
      ok: false,
      error: "invalid_dot",
    });
    expect(canonicalizePattern([0, -1, 1])).toEqual({
      ok: false,
      error: "invalid_dot",
    });
    expect(canonicalizePattern([0, 1.5, 3])).toEqual({
      ok: false,
      error: "invalid_dot",
    });
    expect(canonicalizePattern([0, Number.NaN, 3])).toEqual({
      ok: false,
      error: "invalid_dot",
    });
    expect(canonicalizePattern(["0", "1", "2"])).toEqual({
      ok: false,
      error: "invalid_dot",
    });
    expect(canonicalizePattern([0, null, 2])).toEqual({
      ok: false,
      error: "invalid_dot",
    });
  });

  it("rejects anything that is not an array", () => {
    for (const input of ["0,1,2", null, undefined, 42, {}, { pattern: [0, 1, 2] }]) {
      expect(canonicalizePattern(input)).toEqual({
        ok: false,
        error: "not_an_array",
      });
    }
  });

  it("rejects raw input longer than the grid", () => {
    expect(canonicalizePattern([0, 1, 2, 3, 4, 5, 6, 7, 8, 0])).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("treats order as significant, so reversal and rotation are distinct", () => {
    const forward = canonicalizePattern([0, 1, 2]);
    const reversed = canonicalizePattern([2, 1, 0]);
    const rotated = canonicalizePattern([0, 3, 6]);

    expect(forward.ok && forward.material).toBe("gesture-v1:0.1.2");
    expect(reversed.ok && reversed.material).toBe("gesture-v1:2.1.0");
    expect(rotated.ok && rotated.material).toBe("gesture-v1:0.3.6");
  });

  it("is idempotent, so a canonical pattern re-canonicalizes to itself", () => {
    const first = canonicalizePattern([0, 8, 2]);
    expect(first.ok).toBe(true);

    if (first.ok) {
      expect(canonicalizePattern(first.pattern)).toEqual(first);
    }
  });
});

describe("appendDot", () => {
  it("builds an already-canonical stroke as dots are visited", () => {
    let stroke: number[] = [];
    stroke = appendDot(stroke, 0);
    stroke = appendDot(stroke, 8);
    stroke = appendDot(stroke, 2);

    expect(stroke).toEqual([0, 4, 8, 5, 2]);
    expect(canonicalizePattern(stroke)).toEqual({
      ok: true,
      pattern: [0, 4, 8, 5, 2],
      material: "gesture-v1:0.4.8.5.2",
    });
  });

  it("ignores re-entering a selected dot and returns the same array", () => {
    const stroke = appendDot(appendDot([], 0), 1);
    expect(appendDot(stroke, 1)).toBe(stroke);
    expect(appendDot(stroke, 0)).toBe(stroke);
  });

  it("ignores a dot that was auto-selected as a midpoint", () => {
    const stroke = appendDot(appendDot([], 0), 2);
    expect(stroke).toEqual([0, 1, 2]);
    expect(appendDot(stroke, 1)).toBe(stroke);
  });

  it("ignores invalid dot indexes", () => {
    const stroke = appendDot([], 0);
    expect(appendDot(stroke, 9)).toBe(stroke);
    expect(appendDot(stroke, -1)).toBe(stroke);
    expect(appendDot(stroke, 1.5)).toBe(stroke);
  });
});

describe("toCanonicalMaterial", () => {
  it("produces the versioned dot-joined form", () => {
    expect(toCanonicalMaterial([0, 1, 4, 7])).toBe("gesture-v1:0.1.4.7");
    expect(toCanonicalMaterial([0, 1, 2])).toBe("gesture-v1:0.1.2");
  });
});
