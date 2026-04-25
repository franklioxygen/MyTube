import { getProviderScript } from "../../services/downloaders/ytdlp/ytdlpHelpers";
import { isYouTubeUrl } from "../helpers";

const DEFAULT_YOUTUBE_PLAYER_CLIENT_EXTRACTOR_ARG =
  "youtube:player_client=default,mweb";
const YOUTUBE_PLAYER_CLIENT_ARG_PREFIX = "youtube:player_client=";
const PROVIDER_SCRIPT_ARG_PREFIX = "youtubepot-bgutilscript:script_path=";
export type YtDlpFlagValue =
  | string
  | number
  | boolean
  | readonly (string | number)[]
  | null
  | undefined;
export type YtDlpFlags = Record<string, YtDlpFlagValue>;

function parseExtractorArgParts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseExtractorArgParts(entry));
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function joinExtractorArgParts(parts: string[]): string | undefined {
  const uniqueParts = Array.from(new Set(parts));
  return uniqueParts.length > 0 ? uniqueParts.join(";") : undefined;
}

export function withDefaultYouTubeExtractorArgs(
  url: string,
  flags: YtDlpFlags
): YtDlpFlags {
  if (!isYouTubeUrl(url)) {
    return flags;
  }

  const providerScript = getProviderScript();
  if (!providerScript) {
    return flags;
  }

  const existingParts = parseExtractorArgParts(flags.extractorArgs);
  const mergedParts = [...existingParts];

  if (
    !existingParts.some((part) => part.startsWith(YOUTUBE_PLAYER_CLIENT_ARG_PREFIX))
  ) {
    mergedParts.push(DEFAULT_YOUTUBE_PLAYER_CLIENT_EXTRACTOR_ARG);
  }

  const providerArg = `${PROVIDER_SCRIPT_ARG_PREFIX}${providerScript}`;
  if (!existingParts.some((part) => part.startsWith(PROVIDER_SCRIPT_ARG_PREFIX))) {
    mergedParts.push(providerArg);
  }

  const extractorArgs = joinExtractorArgParts(mergedParts);
  return {
    ...flags,
    extractorArgs,
  };
}

/**
 * Convert camelCase flag names to kebab-case CLI arguments
 */
export function convertFlagToArg(flag: string): string {
  return `--${flag.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
}

// Map of short options to their long equivalents
const SHORT_TO_LONG = new Map<string, string>([
  ["f", "format"],
  ["S", "format-sort"],
  ["o", "output"],
  ["r", "limit-rate"],
  ["R", "retries"],
  ["N", "concurrent-fragments"],
  ["x", "extract-audio"],
  ["k", "keep-video"],
  ["j", "dump-json"],
  ["J", "dump-single-json"],
  ["4", "force-ipv4"],
  ["6", "force-ipv6"],
]);

/**
 * Convert flags object to yt-dlp CLI arguments array
 */
export function flagsToArgs(flags: YtDlpFlags): string[] {
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
          args.push("--add-header", String(header));
        }
      } else {
        args.push("--add-header", String(value));
      }
      continue;
    }

    // Handle short options (single letter flags)
    const longFlag = SHORT_TO_LONG.get(key);
    const argName = longFlag ? `--${longFlag}` : convertFlagToArg(key);

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
