/**
 * Gesture pattern canonicalization for admin Gesture Login.
 *
 * This module is duplicated verbatim in backend/src/utils/gesturePattern.ts and
 * frontend/src/utils/gesturePattern.ts, and both copies are covered by the same
 * fixtures. The backend is authoritative: it never trusts a client-supplied
 * sequence and re-canonicalizes every request before comparing verifiers. Keep
 * the two copies in lockstep - a divergence silently makes an enrolled gesture
 * unverifiable.
 *
 * Dot indexes are row-major on a 3x3 grid:
 *
 *   0 1 2
 *   3 4 5
 *   6 7 8
 */

export const GESTURE_GRID_COLUMNS = 3;
export const GESTURE_GRID_ROWS = 3;
export const GESTURE_DOT_COUNT = GESTURE_GRID_ROWS * GESTURE_GRID_COLUMNS;
export const GESTURE_MIN_CANONICAL_LENGTH = 3;
export const GESTURE_MAX_LENGTH = GESTURE_DOT_COUNT;

/**
 * Version prefix for hashed material. Bump this only if pattern semantics
 * change; it is the migration boundary for stored verifiers.
 */
export const GESTURE_CANONICAL_VERSION = "gesture-v1";

export type GesturePatternErrorCode =
  | "not_an_array"
  | "invalid_dot"
  | "duplicate_dot"
  | "too_long"
  | "too_short";

export type GestureCanonicalizationResult =
  | { ok: true; pattern: number[]; material: string }
  | { ok: false; error: GesturePatternErrorCode };

const isDotIndex = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < GESTURE_DOT_COUNT;

const rowOf = (dot: number): number => Math.floor(dot / GESTURE_GRID_COLUMNS);
const columnOf = (dot: number): number => dot % GESTURE_GRID_COLUMNS;

/**
 * Build the Android-style midpoint lookup from grid geometry rather than a
 * hand-written table, so the eight collinear pairs cannot drift apart from the
 * grid they describe. A midpoint exists only when both coordinate sums are
 * even, which is exactly the "one dot sits halfway between two others" case.
 */
const buildMidpointLookup = (): ReadonlyMap<number, number> => {
  const lookup = new Map<number, number>();

  for (let from = 0; from < GESTURE_DOT_COUNT; from += 1) {
    for (let to = 0; to < GESTURE_DOT_COUNT; to += 1) {
      if (from === to) {
        continue;
      }

      const rowSum = rowOf(from) + rowOf(to);
      const columnSum = columnOf(from) + columnOf(to);
      if (rowSum % 2 !== 0 || columnSum % 2 !== 0) {
        continue;
      }

      const midpoint =
        (rowSum / 2) * GESTURE_GRID_COLUMNS + columnSum / 2;
      if (midpoint === from || midpoint === to) {
        continue;
      }

      lookup.set(from * GESTURE_DOT_COUNT + to, midpoint);
    }
  }

  return lookup;
};

const MIDPOINT_LOOKUP = buildMidpointLookup();

/**
 * The dot that a straight move from `from` to `to` passes through, or null when
 * the move crosses no dot centre. Undirected: getMidpoint(a, b) === getMidpoint(b, a).
 */
export function getMidpoint(from: number, to: number): number | null {
  if (!isDotIndex(from) || !isDotIndex(to)) {
    return null;
  }

  const midpoint = MIDPOINT_LOOKUP.get(from * GESTURE_DOT_COUNT + to);
  return midpoint === undefined ? null : midpoint;
}

/**
 * Append a dot to a stroke in progress, inserting a skipped midpoint when the
 * move jumps over an unselected dot. Re-entering an already selected dot is a
 * no-op, so a stroke built with this helper is always already canonical.
 *
 * Returns the original array unchanged when nothing was added, which lets React
 * callers skip a re-render.
 */
export function appendDot(
  selected: readonly number[],
  dot: number
): number[] {
  if (!isDotIndex(dot) || selected.includes(dot)) {
    return selected as number[];
  }

  const next = [...selected];
  const previous = next[next.length - 1];

  if (previous !== undefined) {
    const midpoint = getMidpoint(previous, dot);
    if (midpoint !== null && !next.includes(midpoint)) {
      next.push(midpoint);
    }
  }

  next.push(dot);
  return next;
}

/**
 * The exact string that is hashed. Never hash JSON: its formatting is not
 * stable enough to be a credential input.
 */
export function toCanonicalMaterial(pattern: readonly number[]): string {
  return `${GESTURE_CANONICAL_VERSION}:${pattern.join(".")}`;
}

/**
 * Validate and canonicalize an untrusted pattern.
 *
 * Duplicates are rejected rather than skipped, both when they appear in the raw
 * input and when a midpoint insertion would collide with a later raw dot (for
 * example [0, 2, 1], where crossing 0 -> 2 already consumes 1). A real stroke
 * cannot produce either shape, because re-entering a selected dot does nothing,
 * so both can only come from a custom client. Rejecting keeps one gesture from
 * having two wire representations.
 */
export function canonicalizePattern(
  raw: unknown
): GestureCanonicalizationResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "not_an_array" };
  }

  if (raw.length > GESTURE_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }

  const seenRaw = new Set<number>();
  for (const entry of raw) {
    if (!isDotIndex(entry)) {
      return { ok: false, error: "invalid_dot" };
    }
    if (seenRaw.has(entry)) {
      return { ok: false, error: "duplicate_dot" };
    }
    seenRaw.add(entry);
  }

  const pattern: number[] = [];
  for (const dot of raw as number[]) {
    const previous = pattern[pattern.length - 1];

    if (previous !== undefined) {
      const midpoint = getMidpoint(previous, dot);
      if (midpoint !== null && !pattern.includes(midpoint)) {
        pattern.push(midpoint);
      }
    }

    if (pattern.includes(dot)) {
      return { ok: false, error: "duplicate_dot" };
    }

    pattern.push(dot);
  }

  if (pattern.length > GESTURE_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }

  if (pattern.length < GESTURE_MIN_CANONICAL_LENGTH) {
    return { ok: false, error: "too_short" };
  }

  return { ok: true, pattern, material: toCanonicalMaterial(pattern) };
}
