import type { Settings } from "../types";
import type { TranslationKey } from "./translations";

export const MIN_PLAYER_SEEK_SECONDS = 1;
export const MAX_PLAYER_SEEK_SECONDS = 3600;

export interface PlayerSeekIntervals {
  shortSeconds: number;
  mediumSeconds: number;
  longSeconds: number;
}

export type SeekDurationUnit = "seconds" | "minutes" | "hours";

export interface SeekDurationEditorValue {
  amount: number;
  unit: SeekDurationUnit;
}

export const SEEK_DURATION_UNIT_SECONDS: Record<SeekDurationUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
};

export const DEFAULT_PLAYER_SEEK_INTERVALS: PlayerSeekIntervals = {
  shortSeconds: 10,
  mediumSeconds: 60,
  longSeconds: 600,
};

type PlayerSeekSettings = Pick<
  Settings,
  | "playerSeekShortSeconds"
  | "playerSeekMediumSeconds"
  | "playerSeekLongSeconds"
>;

type Translate = (
  key: TranslationKey,
  replacements?: Record<string, string | number>
) => string;

export function isValidPlayerSeekSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PLAYER_SEEK_SECONDS &&
    value <= MAX_PLAYER_SEEK_SECONDS
  );
}

export function arePlayerSeekIntervalsOrdered(
  intervals: PlayerSeekIntervals
): boolean {
  return (
    intervals.shortSeconds < intervals.mediumSeconds &&
    intervals.mediumSeconds < intervals.longSeconds
  );
}

export function resolvePlayerSeekIntervals(
  settings?: Partial<PlayerSeekSettings>
): PlayerSeekIntervals {
  const intervals = {
    shortSeconds: settings?.playerSeekShortSeconds,
    mediumSeconds: settings?.playerSeekMediumSeconds,
    longSeconds: settings?.playerSeekLongSeconds,
  };

  if (
    !isValidPlayerSeekSeconds(intervals.shortSeconds) ||
    !isValidPlayerSeekSeconds(intervals.mediumSeconds) ||
    !isValidPlayerSeekSeconds(intervals.longSeconds)
  ) {
    return { ...DEFAULT_PLAYER_SEEK_INTERVALS };
  }

  const resolved: PlayerSeekIntervals = {
    shortSeconds: intervals.shortSeconds,
    mediumSeconds: intervals.mediumSeconds,
    longSeconds: intervals.longSeconds,
  };

  return arePlayerSeekIntervalsOrdered(resolved)
    ? resolved
    : { ...DEFAULT_PLAYER_SEEK_INTERVALS };
}

export function formatSeekDuration(seconds: number, t: Translate): string {
  const parts: string[] = [];
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    parts.push(
      t(hours === 1 ? "seekDurationHour" : "seekDurationHours", {
        count: hours,
      })
    );
  }
  if (minutes > 0) {
    parts.push(
      t(minutes === 1 ? "seekDurationMinute" : "seekDurationMinutes", {
        count: minutes,
      })
    );
  }
  if (remainingSeconds > 0 || parts.length === 0) {
    parts.push(
      t(
        remainingSeconds === 1
          ? "seekDurationSecond"
          : "seekDurationSeconds",
        { count: remainingSeconds }
      )
    );
  }

  return parts.join(" ");
}

export function toSeekDurationEditorValue(
  seconds: number
): SeekDurationEditorValue {
  if (seconds % 3600 === 0) {
    return { amount: seconds / 3600, unit: "hours" };
  }
  if (seconds % 60 === 0) {
    return { amount: seconds / 60, unit: "minutes" };
  }
  return { amount: seconds, unit: "seconds" };
}
