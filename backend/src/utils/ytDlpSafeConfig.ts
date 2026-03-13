import { ValidationError } from "../errors/DownloadErrors";
import { YtDlpSafeConfig } from "../types/settings";

const ALLOWED_MAX_RESOLUTIONS = new Set([360, 480, 720, 1080, 1440, 2160, 4320]);
const ALLOWED_MERGE_OUTPUT_FORMATS = new Set(["mp4", "webm", "mkv"]);
const ALLOWED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks5:", "socks5h:"]);
const LEGACY_ALLOWLIST_KEYS = new Set([
  "proxy",
  "r",
  "limitRate",
  "R",
  "retries",
  "N",
  "concurrentFragments",
  "socketTimeout",
  "4",
  "forceIpv4",
  "6",
  "forceIpv6",
  "xff",
  "sleepRequests",
  "sleepInterval",
  "minSleepInterval",
  "maxSleepInterval",
  "mergeOutputFormat",
  "S",
  "formatSort",
]);

interface NormalizeSafeConfigOptions {
  rejectUnknownKeys?: boolean;
  rejectInvalidValues?: boolean;
}

interface NormalizeSafeConfigResult {
  config: YtDlpSafeConfig;
  rejectedOptions: string[];
}

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return null;
};

const normalizeNumericField = (
  value: unknown,
  key: keyof YtDlpSafeConfig,
  min: number,
  max: number,
  rejectedOptions: string[],
  rejectInvalidValues: boolean
): number | undefined => {
  const parsed = parseInteger(value);
  if (parsed === null || parsed < min || parsed > max) {
    if (rejectInvalidValues) {
      throw new ValidationError(
        `${String(key)} must be an integer between ${min} and ${max}.`,
        String(key)
      );
    }
    rejectedOptions.push(String(key));
    return undefined;
  }
  return parsed;
};

const validateProxy = (
  value: unknown,
  rejectedOptions: string[],
  rejectInvalidValues: boolean
): string | undefined => {
  const normalized = normalizeString(value);
  if (normalized === null) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (rejectInvalidValues) {
      throw new ValidationError("proxy must be a non-empty string.", "proxy");
    }
    rejectedOptions.push("proxy");
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    if (rejectInvalidValues) {
      throw new ValidationError("proxy must be a valid URL.", "proxy");
    }
    rejectedOptions.push("proxy");
    return undefined;
  }

  if (!ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    if (rejectInvalidValues) {
      throw new ValidationError(
        "proxy protocol must be one of: http, https, socks5, socks5h.",
        "proxy"
      );
    }
    rejectedOptions.push("proxy");
    return undefined;
  }

  return normalized;
};

const validateLimitRate = (
  value: unknown,
  rejectedOptions: string[],
  rejectInvalidValues: boolean
): string | undefined => {
  const normalized = normalizeString(value);
  if (normalized === null) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (rejectInvalidValues) {
      throw new ValidationError("limitRate must be a non-empty string.", "limitRate");
    }
    rejectedOptions.push("limitRate");
    return undefined;
  }

  if (!/^\d+(\.\d+)?[KMG]?$/i.test(normalized)) {
    if (rejectInvalidValues) {
      throw new ValidationError(
        "limitRate must match <number>[K|M|G], e.g. 500K or 2M.",
        "limitRate"
      );
    }
    rejectedOptions.push("limitRate");
    return undefined;
  }

  return normalized;
};

const validateXff = (
  value: unknown,
  rejectedOptions: string[],
  rejectInvalidValues: boolean
): string | undefined => {
  const normalized = normalizeString(value);
  if (normalized === null) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (rejectInvalidValues) {
      throw new ValidationError("xff must be a non-empty string.", "xff");
    }
    rejectedOptions.push("xff");
    return undefined;
  }

  if (!/^(default|[A-Za-z]{2})$/.test(normalized)) {
    if (rejectInvalidValues) {
      throw new ValidationError(
        "xff must be 'default' or a 2-letter country code.",
        "xff"
      );
    }
    rejectedOptions.push("xff");
    return undefined;
  }

  return normalized;
};

const parseFormatSortResolution = (
  formatSortValue: string | undefined
): { maxResolution?: YtDlpSafeConfig["maxResolution"]; rejectedTokens: string[] } => {
  if (!formatSortValue) {
    return { rejectedTokens: [] };
  }

  const tokens = formatSortValue
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return { rejectedTokens: [] };
  }

  const rejectedTokens: string[] = [];
  let maxResolution: YtDlpSafeConfig["maxResolution"];

  for (const token of tokens) {
    if (!token.startsWith("res:")) {
      rejectedTokens.push(`formatSort:${token}`);
      continue;
    }

    const rawRes = token.slice("res:".length);
    const parsedRes = parseInteger(rawRes);
    if (parsedRes === null || !ALLOWED_MAX_RESOLUTIONS.has(parsedRes)) {
      rejectedTokens.push(`formatSort:${token}`);
      continue;
    }

    maxResolution = parsedRes as YtDlpSafeConfig["maxResolution"];
  }

  return { maxResolution, rejectedTokens };
};

export function parseLegacyYtDlpConfigText(configText: string): Record<string, unknown> {
  const flags: Record<string, unknown> = {};

  if (!configText || typeof configText !== "string") {
    return flags;
  }

  const lines = configText.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    let optionName: string | null = null;
    let optionValue: string | boolean = true;

    if (line.startsWith("--")) {
      const spaceIndex = line.indexOf(" ");
      if (spaceIndex === -1) {
        optionName = line.substring(2);
      } else {
        optionName = line.substring(2, spaceIndex);
        optionValue = line.substring(spaceIndex + 1).trim();
      }
    } else if (line.startsWith("-") && !line.startsWith("--")) {
      const parts = line.split(/\s+/);
      optionName = parts[0].substring(1);
      if (parts.length > 1) {
        optionValue = parts.slice(1).join(" ");
      }
    }

    if (typeof optionValue === "string") {
      const trimmed = optionValue.trim();
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ) {
        optionValue = trimmed.slice(1, -1);
      } else {
        optionValue = trimmed;
      }
    }

    if (optionName) {
      const camelCaseName = optionName.replace(/-([a-z])/g, (_full, letter) =>
        letter.toUpperCase()
      );
      flags[camelCaseName] = optionValue;
    }
  }

  return flags;
}

export function normalizeYtDlpSafeConfig(
  rawConfig: unknown,
  options: NormalizeSafeConfigOptions = {}
): NormalizeSafeConfigResult {
  const rejectUnknownKeys = options.rejectUnknownKeys ?? true;
  const rejectInvalidValues = options.rejectInvalidValues ?? true;
  const rejectedOptions: string[] = [];
  const config: YtDlpSafeConfig = {};

  if (rawConfig === undefined || rawConfig === null) {
    return { config, rejectedOptions };
  }

  if (typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new ValidationError(
      "ytDlpSafeConfig must be an object.",
      "ytDlpSafeConfig"
    );
  }

  for (const [rawKey, rawValue] of Object.entries(rawConfig as Record<string, unknown>)) {
    switch (rawKey) {
      case "maxResolution": {
        const parsed = parseInteger(rawValue);
        if (parsed === null || !ALLOWED_MAX_RESOLUTIONS.has(parsed)) {
          if (rejectInvalidValues) {
            throw new ValidationError(
              "maxResolution must be one of 360, 480, 720, 1080, 1440, 2160, 4320.",
              "maxResolution"
            );
          }
          rejectedOptions.push("maxResolution");
          break;
        }
        config.maxResolution = parsed as YtDlpSafeConfig["maxResolution"];
        break;
      }
      case "mergeOutputFormat": {
        const normalized = normalizeString(rawValue);
        if (
          normalized === null ||
          !ALLOWED_MERGE_OUTPUT_FORMATS.has(normalized.toLowerCase())
        ) {
          if (rejectInvalidValues) {
            throw new ValidationError(
              "mergeOutputFormat must be one of mp4, webm, mkv.",
              "mergeOutputFormat"
            );
          }
          rejectedOptions.push("mergeOutputFormat");
          break;
        }
        config.mergeOutputFormat =
          normalized.toLowerCase() as YtDlpSafeConfig["mergeOutputFormat"];
        break;
      }
      case "proxy": {
        const proxy = validateProxy(rawValue, rejectedOptions, rejectInvalidValues);
        if (proxy) {
          config.proxy = proxy;
        }
        break;
      }
      case "limitRate": {
        const limitRate = validateLimitRate(
          rawValue,
          rejectedOptions,
          rejectInvalidValues
        );
        if (limitRate) {
          config.limitRate = limitRate;
        }
        break;
      }
      case "retries": {
        const value = normalizeNumericField(
          rawValue,
          "retries",
          0,
          20,
          rejectedOptions,
          rejectInvalidValues
        );
        if (value !== undefined) {
          config.retries = value;
        }
        break;
      }
      case "concurrentFragments": {
        const value = normalizeNumericField(
          rawValue,
          "concurrentFragments",
          1,
          16,
          rejectedOptions,
          rejectInvalidValues
        );
        if (value !== undefined) {
          config.concurrentFragments = value;
        }
        break;
      }
      case "socketTimeout": {
        const value = normalizeNumericField(
          rawValue,
          "socketTimeout",
          1,
          300,
          rejectedOptions,
          rejectInvalidValues
        );
        if (value !== undefined) {
          config.socketTimeout = value;
        }
        break;
      }
      case "forceIpVersion": {
        const normalized = normalizeString(rawValue)?.toLowerCase();
        if (normalized !== "ipv4" && normalized !== "ipv6") {
          if (rejectInvalidValues) {
            throw new ValidationError(
              "forceIpVersion must be either ipv4 or ipv6.",
              "forceIpVersion"
            );
          }
          rejectedOptions.push("forceIpVersion");
          break;
        }
        config.forceIpVersion = normalized;
        break;
      }
      case "xff": {
        const xff = validateXff(rawValue, rejectedOptions, rejectInvalidValues);
        if (xff) {
          config.xff = xff;
        }
        break;
      }
      case "sleepRequests": {
        const value = normalizeNumericField(
          rawValue,
          "sleepRequests",
          0,
          300,
          rejectedOptions,
          rejectInvalidValues
        );
        if (value !== undefined) {
          config.sleepRequests = value;
        }
        break;
      }
      case "sleepInterval": {
        const value = normalizeNumericField(
          rawValue,
          "sleepInterval",
          0,
          3600,
          rejectedOptions,
          rejectInvalidValues
        );
        if (value !== undefined) {
          config.sleepInterval = value;
        }
        break;
      }
      case "maxSleepInterval": {
        const value = normalizeNumericField(
          rawValue,
          "maxSleepInterval",
          0,
          7200,
          rejectedOptions,
          rejectInvalidValues
        );
        if (value !== undefined) {
          config.maxSleepInterval = value;
        }
        break;
      }
      default: {
        if (rejectUnknownKeys) {
          throw new ValidationError(
            `Unsupported ytDlpSafeConfig option: ${rawKey}.`,
            "ytDlpSafeConfig"
          );
        }
        rejectedOptions.push(rawKey);
      }
    }
  }

  if (
    config.sleepInterval !== undefined &&
    config.maxSleepInterval !== undefined &&
    config.maxSleepInterval < config.sleepInterval
  ) {
    if (rejectInvalidValues) {
      throw new ValidationError(
        "maxSleepInterval must be greater than or equal to sleepInterval.",
        "maxSleepInterval"
      );
    }
    rejectedOptions.push("maxSleepInterval");
    delete config.maxSleepInterval;
  }

  return { config, rejectedOptions };
}

export function convertYtDlpSafeConfigToFlags(
  safeConfig: YtDlpSafeConfig
): Record<string, unknown> {
  const flags: Record<string, unknown> = {};

  if (safeConfig.maxResolution !== undefined) {
    flags.formatSort = `res:${safeConfig.maxResolution}`;
  }
  if (safeConfig.mergeOutputFormat) {
    flags.mergeOutputFormat = safeConfig.mergeOutputFormat;
  }
  if (safeConfig.proxy) {
    flags.proxy = safeConfig.proxy;
  }
  if (safeConfig.limitRate) {
    flags.limitRate = safeConfig.limitRate;
  }
  if (safeConfig.retries !== undefined) {
    flags.retries = safeConfig.retries;
  }
  if (safeConfig.concurrentFragments !== undefined) {
    flags.concurrentFragments = safeConfig.concurrentFragments;
  }
  if (safeConfig.socketTimeout !== undefined) {
    flags.socketTimeout = safeConfig.socketTimeout;
  }
  if (safeConfig.forceIpVersion === "ipv4") {
    flags.forceIpv4 = true;
  } else if (safeConfig.forceIpVersion === "ipv6") {
    flags.forceIpv6 = true;
  }
  if (safeConfig.xff) {
    flags.xff = safeConfig.xff;
  }
  if (safeConfig.sleepRequests !== undefined) {
    flags.sleepRequests = safeConfig.sleepRequests;
  }
  if (safeConfig.sleepInterval !== undefined) {
    flags.sleepInterval = safeConfig.sleepInterval;
  }
  if (safeConfig.maxSleepInterval !== undefined) {
    flags.maxSleepInterval = safeConfig.maxSleepInterval;
  }

  return flags;
}

export function deriveYtDlpSafeConfigFromLegacyText(
  configText: string
): NormalizeSafeConfigResult {
  const parsed = parseLegacyYtDlpConfigText(configText);
  const rejectedOptions: string[] = [];

  for (const key of Object.keys(parsed)) {
    if (!LEGACY_ALLOWLIST_KEYS.has(key)) {
      rejectedOptions.push(key);
    }
  }

  const candidate: Partial<YtDlpSafeConfig> = {};

  if (parsed.proxy !== undefined) {
    candidate.proxy = parsed.proxy as string;
  }
  if (parsed.r !== undefined) {
    candidate.limitRate = parsed.r as string;
  } else if (parsed.limitRate !== undefined) {
    candidate.limitRate = parsed.limitRate as string;
  }
  if (parsed.R !== undefined) {
    candidate.retries = parsed.R as number;
  } else if (parsed.retries !== undefined) {
    candidate.retries = parsed.retries as number;
  }
  if (parsed.N !== undefined) {
    candidate.concurrentFragments = parsed.N as number;
  } else if (parsed.concurrentFragments !== undefined) {
    candidate.concurrentFragments = parsed.concurrentFragments as number;
  }
  if (parsed.socketTimeout !== undefined) {
    candidate.socketTimeout = parsed.socketTimeout as number;
  }

  if (parsed.forceIpv6 === true || parsed["6"] === true) {
    candidate.forceIpVersion = "ipv6";
  } else if (parsed.forceIpv4 === true || parsed["4"] === true) {
    candidate.forceIpVersion = "ipv4";
  }

  if (parsed.xff !== undefined) {
    candidate.xff = parsed.xff as string;
  }
  if (parsed.sleepRequests !== undefined) {
    candidate.sleepRequests = parsed.sleepRequests as number;
  }
  if (parsed.sleepInterval !== undefined) {
    candidate.sleepInterval = parsed.sleepInterval as number;
  } else if (parsed.minSleepInterval !== undefined) {
    candidate.sleepInterval = parsed.minSleepInterval as number;
  }
  if (parsed.maxSleepInterval !== undefined) {
    candidate.maxSleepInterval = parsed.maxSleepInterval as number;
  }
  if (parsed.mergeOutputFormat !== undefined) {
    candidate.mergeOutputFormat = parsed.mergeOutputFormat as
      | "mp4"
      | "webm"
      | "mkv";
  }

  const formatSortRaw =
    typeof parsed.S === "string"
      ? parsed.S
      : typeof parsed.formatSort === "string"
        ? parsed.formatSort
        : undefined;
  const { maxResolution, rejectedTokens } = parseFormatSortResolution(
    formatSortRaw
  );
  if (maxResolution !== undefined) {
    candidate.maxResolution = maxResolution;
  }
  rejectedOptions.push(...rejectedTokens);

  const normalized = normalizeYtDlpSafeConfig(candidate, {
    rejectUnknownKeys: false,
    rejectInvalidValues: false,
  });

  return {
    config: normalized.config,
    rejectedOptions: Array.from(
      new Set([...rejectedOptions, ...normalized.rejectedOptions])
    ),
  };
}
