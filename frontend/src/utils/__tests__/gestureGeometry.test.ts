import { describe, expect, it } from "vitest";
import {
  GESTURE_DOT_CENTERS,
  GESTURE_HIT_RADIUS,
  GESTURE_VIEW_BOX,
  dotsAlongSegment,
  findDotAtPoint,
  toViewBoxPoint,
} from "../gestureGeometry";

const none = () => false;
const centerOf = (index: number) => GESTURE_DOT_CENTERS[index];

describe("GESTURE_DOT_CENTERS", () => {
  it("lays out nine dots row-major inside the viewBox", () => {
    expect(GESTURE_DOT_CENTERS).toHaveLength(9);
    expect(centerOf(0)).toEqual({ x: 50, y: 50 });
    expect(centerOf(4)).toEqual({ x: 150, y: 150 });
    expect(centerOf(8)).toEqual({ x: 250, y: 250 });
    // Index 2 is top-right, not bottom-left: row-major, matching the backend.
    expect(centerOf(2)).toEqual({ x: 250, y: 50 });
    expect(centerOf(6)).toEqual({ x: 50, y: 250 });
  });

  it("keeps every dot inside the box", () => {
    for (const center of GESTURE_DOT_CENTERS) {
      expect(center.x).toBeGreaterThan(0);
      expect(center.x).toBeLessThan(GESTURE_VIEW_BOX);
      expect(center.y).toBeGreaterThan(0);
      expect(center.y).toBeLessThan(GESTURE_VIEW_BOX);
    }
  });

  it("spaces dots so their hit circles never overlap", () => {
    // Overlapping targets would make the dot a fast swipe selects ambiguous.
    for (let a = 0; a < 9; a += 1) {
      for (let b = a + 1; b < 9; b += 1) {
        const dx = centerOf(a).x - centerOf(b).x;
        const dy = centerOf(a).y - centerOf(b).y;
        expect(Math.hypot(dx, dy)).toBeGreaterThan(GESTURE_HIT_RADIUS * 2);
      }
    }
  });
});

describe("findDotAtPoint", () => {
  it("finds a dot under an exact centre", () => {
    for (let index = 0; index < 9; index += 1) {
      expect(findDotAtPoint(centerOf(index))).toBe(index);
    }
  });

  it("finds a dot from a near miss inside the hit radius", () => {
    expect(findDotAtPoint({ x: 50 + 20, y: 50 + 20 })).toBe(0);
  });

  it("returns null in the gaps between dots", () => {
    expect(findDotAtPoint({ x: 100, y: 100 })).toBeNull();
    expect(findDotAtPoint({ x: 0, y: 0 })).toBeNull();
    expect(findDotAtPoint({ x: 299, y: 299 })).toBeNull();
  });
});

describe("dotsAlongSegment", () => {
  it("returns the crossed dot for a fast swipe that never sampled it", () => {
    // The whole point: on a high-refresh screen a swipe across the top row can
    // report no pointer sample inside dot 1 at all.
    expect(dotsAlongSegment(centerOf(0), centerOf(2), none)).toEqual([0, 1, 2]);
  });

  it("orders dots by position along the segment, following the direction drawn", () => {
    expect(dotsAlongSegment(centerOf(2), centerOf(0), none)).toEqual([2, 1, 0]);
    expect(dotsAlongSegment(centerOf(0), centerOf(8), none)).toEqual([0, 4, 8]);
    expect(dotsAlongSegment(centerOf(8), centerOf(0), none)).toEqual([8, 4, 0]);
  });

  it("skips dots that are already selected", () => {
    const selected = new Set([0, 1]);
    expect(
      dotsAlongSegment(centerOf(0), centerOf(2), (index) => selected.has(index))
    ).toEqual([2]);
  });

  it("does not report dots beyond either end of the segment", () => {
    // Stopping halfway between 0 and 1 must not pick up 2.
    expect(dotsAlongSegment(centerOf(0), { x: 150, y: 50 }, none)).toEqual([0, 1]);
    expect(dotsAlongSegment({ x: 150, y: 50 }, centerOf(2), none)).toEqual([1, 2]);
  });

  it("returns nothing for a segment that stays in the gaps", () => {
    expect(dotsAlongSegment({ x: 100, y: 100 }, { x: 100, y: 200 }, none)).toEqual([]);
  });

  it("handles a zero-length segment as a point test", () => {
    expect(dotsAlongSegment(centerOf(4), centerOf(4), none)).toEqual([4]);
    expect(dotsAlongSegment({ x: 100, y: 100 }, { x: 100, y: 100 }, none)).toEqual([]);
  });

  it("picks up a dot grazed by a segment that passes near it", () => {
    const grazing = dotsAlongSegment(
      { x: 50, y: 50 },
      { x: 250, y: 70 },
      none
    );
    expect(grazing[0]).toBe(0);
    expect(grazing).toContain(1);
  });
});

describe("toViewBoxPoint", () => {
  it("maps client coordinates into viewBox units", () => {
    const rect = { left: 100, top: 200, width: 600, height: 600 };

    // Halfway across a 600px box is the centre of a 300-unit viewBox.
    expect(toViewBoxPoint(rect, 400, 500)).toEqual({ x: 150, y: 150 });
    expect(toViewBoxPoint(rect, 100, 200)).toEqual({ x: 0, y: 0 });
  });

  it("scales independently of the rendered size, so resize needs no recompute", () => {
    const small = { left: 0, top: 0, width: 240, height: 240 };
    const large = { left: 0, top: 0, width: 900, height: 900 };

    expect(toViewBoxPoint(small, 40, 40)).toEqual(toViewBoxPoint(large, 150, 150));
  });

  it("returns null for a zero-sized element", () => {
    // Happens while a dialog is still animating open.
    expect(toViewBoxPoint({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toBeNull();
  });
});
