import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYER_SEEK_INTERVALS,
  arePlayerSeekIntervalsOrdered,
  isValidPlayerSeekSeconds,
  resolvePlayerSeekIntervals,
  toSeekDurationEditorValue,
} from "../playerSeekIntervals";

describe("playerSeekIntervals", () => {
  it.each([1, 10, 60, 600, 3600])(
    "accepts valid seek seconds value %i",
    (value) => {
      expect(isValidPlayerSeekSeconds(value)).toBe(true);
    }
  );

  it.each([0, -1, 3601, 10.5, "10", null, undefined])(
    "rejects invalid seek seconds value %j",
    (value) => {
      expect(isValidPlayerSeekSeconds(value)).toBe(false);
    }
  );

  it("recognizes strictly increasing intervals", () => {
    expect(
      arePlayerSeekIntervalsOrdered({
        shortSeconds: 15,
        mediumSeconds: 120,
        longSeconds: 900,
      })
    ).toBe(true);
    expect(
      arePlayerSeekIntervalsOrdered({
        shortSeconds: 15,
        mediumSeconds: 15,
        longSeconds: 900,
      })
    ).toBe(false);
  });

  it("resolves a valid custom triplet", () => {
    expect(
      resolvePlayerSeekIntervals({
        playerSeekShortSeconds: 15,
        playerSeekMediumSeconds: 120,
        playerSeekLongSeconds: 900,
      })
    ).toEqual({
      shortSeconds: 15,
      mediumSeconds: 120,
      longSeconds: 900,
    });
  });

  it.each([
    undefined,
    {},
    {
      playerSeekShortSeconds: 0,
      playerSeekMediumSeconds: 60,
      playerSeekLongSeconds: 600,
    },
    {
      playerSeekShortSeconds: 60,
      playerSeekMediumSeconds: 10,
      playerSeekLongSeconds: 600,
    },
  ])("falls back as a group for missing or invalid settings", (settings) => {
    expect(resolvePlayerSeekIntervals(settings)).toEqual(
      DEFAULT_PLAYER_SEEK_INTERVALS
    );
  });

  it.each([
    [10, { amount: 10, unit: "seconds" }],
    [60, { amount: 1, unit: "minutes" }],
    [90, { amount: 90, unit: "seconds" }],
    [120, { amount: 2, unit: "minutes" }],
    [3600, { amount: 1, unit: "hours" }],
  ])("converts %i seconds to an exact editor value", (seconds, expected) => {
    expect(toSeekDurationEditorValue(seconds as number)).toEqual(expected);
  });
});
