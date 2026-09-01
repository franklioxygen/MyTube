/**
 * Pure geometry for the 3x3 gesture grid.
 *
 * Kept separate from gesturePattern.ts so that file can stay a verbatim twin of
 * the backend copy: canonicalization is shared, hit-testing is not.
 *
 * All coordinates are in viewBox units rather than CSS pixels. The SVG scales
 * itself, so the logical grid never has to be recomputed on resize or
 * orientation change - only the bounding rect used to convert a pointer
 * position, which is read fresh on each event.
 */

export interface Point {
  x: number;
  y: number;
}

/** Side of the square viewBox the grid is drawn in. */
export const GESTURE_VIEW_BOX = 300;

/** Radius of the drawn dot. */
export const GESTURE_DOT_RADIUS = 11;

/**
 * Radius used for hit-testing, generously larger than the visible dot.
 *
 * At the narrowest layout the grid is given (about 240 CSS px), this is a
 * 48 CSS px target, which clears the 44 px minimum. Widening the visible dot
 * to match would make the grid look like nine buttons.
 */
export const GESTURE_HIT_RADIUS = 30;

const CELL = GESTURE_VIEW_BOX / 3;

/** Row-major centres: index 0 is top-left, index 8 is bottom-right. */
export const GESTURE_DOT_CENTERS: readonly Point[] = Array.from(
  { length: 9 },
  (_, index) => ({
    x: (index % 3) * CELL + CELL / 2,
    y: Math.floor(index / 3) * CELL + CELL / 2,
  })
);

const distanceSquared = (a: Point, b: Point): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

/** The dot under a point, or null when the point is in the gaps. */
export function findDotAtPoint(
  point: Point,
  hitRadius: number = GESTURE_HIT_RADIUS
): number | null {
  let closest: number | null = null;
  let closestDistance = hitRadius * hitRadius;

  GESTURE_DOT_CENTERS.forEach((center, index) => {
    const distance = distanceSquared(point, center);
    if (distance <= closestDistance) {
      closest = index;
      closestDistance = distance;
    }
  });

  return closest;
}

/**
 * Every unselected dot a straight move crosses, in the order it is crossed.
 *
 * Sampling individual pointer positions is not enough on a high-refresh
 * touchscreen: a fast swipe from the top-left to the top-right corner can
 * report no sample inside the middle dot at all. Testing the whole segment
 * against each dot circle catches those, and ordering by position along the
 * segment keeps the resulting pattern faithful to the direction drawn.
 */
export function dotsAlongSegment(
  from: Point,
  to: Point,
  isSelected: (index: number) => boolean,
  hitRadius: number = GESTURE_HIT_RADIUS
): number[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const hits: Array<{ index: number; along: number }> = [];

  GESTURE_DOT_CENTERS.forEach((center, index) => {
    if (isSelected(index)) {
      return;
    }

    // Closest approach of the centre to the segment, clamped to its ends so a
    // dot beyond either end is not treated as crossed.
    const along =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((center.x - from.x) * dx + (center.y - from.y) * dy) /
                lengthSquared
            )
          );

    const closest: Point = { x: from.x + along * dx, y: from.y + along * dy };
    if (distanceSquared(center, closest) <= hitRadius * hitRadius) {
      hits.push({ index, along });
    }
  });

  hits.sort((a, b) => a.along - b.along);
  return hits.map((hit) => hit.index);
}

/**
 * Convert a client-space pointer position into viewBox units.
 * Returns null for a zero-sized element, which happens while a dialog animates.
 */
export function toViewBoxPoint(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number
): Point | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    x: ((clientX - rect.left) / rect.width) * GESTURE_VIEW_BOX,
    y: ((clientY - rect.top) / rect.height) * GESTURE_VIEW_BOX,
  };
}
