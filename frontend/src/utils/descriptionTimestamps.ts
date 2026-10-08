import { parseDuration } from './formatUtils';

export interface DescriptionTimestamp {
  text: string;
  seconds: number;
}

export type DescriptionPart = string | DescriptionTimestamp;

// `1:23`, `12:34` or `1:02:03`, standing on its own. Seconds (and minutes,
// once there are hours) must be two digits under 60, so a ratio like `16:9`
// is never read as a time, and the word boundaries keep `v1:23` or `10:30am`
// as plain text.
const TIMESTAMP_PATTERN = /\b(?:\d{1,2}:[0-5]\d|\d{1,2}):[0-5]\d\b/g;

/**
 * Split a video description into plain text and the timestamps in it, the
 * way YouTube turns chapter lists into links. A timestamp at or past
 * `durationSeconds` stays text: it is not a point in this video (e.g. "doors
 * open 19:30" in a ten-minute one), and landing on the very end fires
 * `ended`, which would autoplay the next video. Pass 0 when the duration is
 * unknown to keep every timestamp.
 */
export const splitDescriptionTimestamps = (
  description: string,
  durationSeconds = 0,
): DescriptionPart[] => {
  const parts: DescriptionPart[] = [];
  let textStart = 0;

  for (const match of description.matchAll(TIMESTAMP_PATTERN)) {
    const end = match.index + match[0].length;
    // A colon counts as a word boundary, so `\b` alone would pull `2:03` out
    // of `1:2:03` or `12:34:56` out of `12:34:56:78`. (No lookbehind: Safari
    // only parses it from 16.4, and an unparsable regex breaks the module.)
    const insideLongerRun =
      description[match.index - 1] === ':' ||
      /^:\d/.test(description.slice(end, end + 2));
    const seconds = parseDuration(match[0]);
    if (insideLongerRun || (durationSeconds > 0 && seconds >= durationSeconds)) {
      continue;
    }
    if (match.index > textStart) {
      parts.push(description.slice(textStart, match.index));
    }
    parts.push({ text: match[0], seconds });
    textStart = end;
  }

  if (textStart < description.length) {
    parts.push(description.slice(textStart));
  }
  return parts;
};
