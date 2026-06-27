/**
 * Convert camelCase flag names to kebab-case CLI arguments
 */
export function convertFlagToArg(flag: string): string {
  return `--${flag.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
}

// Map of short options to their long equivalents
const SHORT_TO_LONG: Record<string, string> = {
  f: "format",
  S: "format-sort",
  o: "output",
  r: "limit-rate",
  R: "retries",
  N: "concurrent-fragments",
  x: "extract-audio",
  k: "keep-video",
  j: "dump-json",
  J: "dump-single-json",
  "4": "force-ipv4",
  "6": "force-ipv6",
};

/**
 * Convert flags object to yt-dlp CLI arguments array
 */
export function flagsToArgs(flags: Record<string, any>): string[] {
  const args: string[] = [];

  for (const [key, value] of Object.entries(flags)) {
    if (value === undefined || value === null) {
      continue;
    }

    // Handle special cases
    if (key === "extractorArgs") {
      if (Array.isArray(value)) {
        for (const extractorArg of value) {
          if (extractorArg) {
            args.push("--extractor-args", String(extractorArg));
          }
        }
      } else if (typeof value === "string" || typeof value === "number") {
        args.push("--extractor-args", String(value));
      }
      continue;
    }

    if (key === "addHeader") {
      // addHeader is an array of "key:value" strings
      if (Array.isArray(value)) {
        for (const header of value) {
          args.push("--add-header", header);
        }
      } else {
        args.push("--add-header", value);
      }
      continue;
    }

    // Handle short options (single letter flags)
    let argName: string;
    if (SHORT_TO_LONG[key]) {
      // Convert short option to long form
      argName = `--${SHORT_TO_LONG[key]}`;
    } else {
      // Convert camelCase to kebab-case
      argName = convertFlagToArg(key);
    }

    if (typeof value === "boolean") {
      if (value) {
        args.push(argName);
      }
    } else if (typeof value === "string" || typeof value === "number") {
      args.push(argName, String(value));
    } else if (Array.isArray(value)) {
      // For arrays, join with comma or repeat the flag
      args.push(argName, value.join(","));
    }
  }

  return args;
}
