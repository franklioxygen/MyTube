import { spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import { DATA_DIR } from "../config/paths";
import * as storageService from "../services/storageService";

const YT_DLP_PATH = process.env.YT_DLP_PATH || "yt-dlp";
const COOKIES_PATH = path.join(DATA_DIR, "cookies.txt");

/**
 * Get cookies file path if it exists
 */
function getCookiesPath(): string | null {
  if (fs.existsSync(COOKIES_PATH)) {
    return COOKIES_PATH;
  }
  return null;
}

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
      // Support semicolon-separated extractor args (e.g., "youtube:key=value;other:key=value")
      if (typeof value === "string" && value.includes(";")) {
        const parts = value.split(";");
        for (const part of parts) {
          if (part.trim()) {
            args.push("--extractor-args", part.trim());
          }
        }
      } else {
        args.push("--extractor-args", value);
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

/**
 * Execute yt-dlp with JSON output and return parsed result
 * @param url - Video URL
 * @param flags - yt-dlp flags
 * @param retryWithoutFormatRestrictions - If true, retry without format restrictions if format error occurs
 */
export async function executeYtDlpJson(
  url: string,
  flags: Record<string, any> = {},
  retryWithoutFormatRestrictions: boolean = true
): Promise<any> {
  const args = ["--dump-single-json", "--no-warnings", ...flagsToArgs(flags)];

  // Add cookies if file exists
  const cookiesPath = getCookiesPath();
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  // Add Node.js runtime for YouTube n challenge solving.
  // Although yt-dlp recommends Deno, it fails on Alpine Linux (musl) without complex workarounds.
  // Node.js is already available in the container and provides a stable alternative.
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    args.push("--js-runtime", "node");
  }

  args.push(url);

  console.log(`Executing: ${YT_DLP_PATH} ${args.join(" ")}`);

  return new Promise<any>((resolve, reject) => {
    const subprocess = spawn(YT_DLP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    subprocess.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    subprocess.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    subprocess.on("close", async (code) => {
      if (code !== 0) {
        // Check if this is a format availability error
        const isFormatError =
          stderr.includes("Requested format is not available") ||
          stderr.includes("format is not available") ||
          stderr.includes("No video formats found");

        // If it's a format error and we should retry, try again without format restrictions
        if (isFormatError && retryWithoutFormatRestrictions) {
          const hasFormatRestrictions =
            (flags.formatSort !== undefined && flags.formatSort !== null) ||
            (flags.format !== undefined && flags.format !== null) ||
            (flags.S !== undefined && flags.S !== null) ||
            (flags.f !== undefined && flags.f !== null);

          if (hasFormatRestrictions) {
            console.log(
              "Format not available, retrying without format restrictions..."
            );
            try {
              // Remove format-related flags
              const retryFlags = { ...flags };
              delete retryFlags.formatSort;
              delete retryFlags.format;
              delete retryFlags.S;
              delete retryFlags.f;
              // Retry without format restrictions (don't retry again to avoid infinite loop)
              const result = await executeYtDlpJson(url, retryFlags, false);
              resolve(result);
              return;
            } catch (retryError) {
              // If retry also fails, reject with original error
              const error = new Error(
                `yt-dlp process exited with code ${code}`
              );
              (error as any).stderr = stderr;
              reject(error);
              return;
            }
          } else {
            // Format error but no format restrictions in flags - might be from config file
            // Try with explicit format override to bypass config file
            console.log(
              "Format not available (possibly from config file), retrying with explicit format override..."
            );
            try {
              const retryFlags = {
                ...flags,
                // Explicitly set format to "best" to override any config file settings
                format: "best",
                formatSort: undefined,
                S: undefined,
                f: undefined,
              };
              // Retry without format restrictions (don't retry again to avoid infinite loop)
              const result = await executeYtDlpJson(url, retryFlags, false);
              resolve(result);
              return;
            } catch (retryError) {
              // If retry also fails, reject with original error
              const error = new Error(
                `yt-dlp process exited with code ${code}`
              );
              (error as any).stderr = stderr;
              reject(error);
              return;
            }
          }
        }

        const error = new Error(`yt-dlp process exited with code ${code}`);
        (error as any).stderr = stderr;
        reject(error);
        return;
      }

      if (
        stderr &&
        !stderr.includes("[download]") &&
        !stderr.includes("[info]")
      ) {
        console.warn("yt-dlp stderr:", stderr);
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        console.error("Failed to parse yt-dlp JSON output:", parseError);
        console.error("Output:", stdout);
        reject(new Error("Failed to parse yt-dlp output as JSON"));
      }
    });

    subprocess.on("error", (error) => {
      reject(error);
    });
  });
}

/**
 * Execute yt-dlp with spawn for progress tracking
 * Returns a subprocess-like object with kill() method
 */
export function executeYtDlpSpawn(
  url: string,
  flags: Record<string, any> = {}
): {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill: (signal?: NodeJS.Signals) => boolean;
  then: (
    onFulfilled?: (value: void) => void | Promise<void>,
    onRejected?: (reason: any) => void | Promise<void>
  ) => Promise<void>;
} {
  const args = [...flagsToArgs(flags)];

  // Add cookies if file exists
  const cookiesPath = getCookiesPath();
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  // Add Node.js runtime for YouTube n challenge solving.
  // Although yt-dlp recommends Deno, it fails on Alpine Linux (musl) without complex workarounds.
  // Node.js is already available in the container and provides a stable alternative.
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    args.push("--js-runtime", "node");
  }

  args.push(url);

  console.log(`Spawning: ${YT_DLP_PATH} ${args.join(" ")}`);

  const subprocess = spawn(YT_DLP_PATH, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let resolved = false;
  let rejected = false;
  let stderr = "";

  // Capture stderr for error reporting
  subprocess.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  const promise = new Promise<void>((resolve, reject) => {
    subprocess.on("close", (code) => {
      if (code === 0) {
        if (!resolved && !rejected) {
          resolved = true;
          resolve();
        }
      } else {
        if (!resolved && !rejected) {
          rejected = true;
          const error = new Error(`yt-dlp process exited with code ${code}`);
          (error as any).stderr = stderr;
          (error as any).code = code;
          console.error("yt-dlp error output:", stderr);
          reject(error);
        }
      }
    });

    subprocess.on("error", (error) => {
      if (!resolved && !rejected) {
        rejected = true;
        reject(error);
      }
    });
  });

  return {
    stdout: subprocess.stdout,
    stderr: subprocess.stderr,
    kill: (signal?: NodeJS.Signals) => {
      if (!subprocess.killed) {
        return subprocess.kill(signal);
      }
      return false;
    },
    then: promise.then.bind(promise),
  };
}

/**
 * Parse yt-dlp configuration text into flags object
 * Supports standard yt-dlp config file format (one option per line, # for comments)
 */
export function parseYtDlpConfig(configText: string): Record<string, any> {
  const flags: Record<string, any> = {};

  if (!configText || typeof configText !== "string") {
    return flags;
  }

  const lines = configText.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) {
      continue;
    }

    // Parse the option
    // Options can be:
    // -f value
    // --format value
    // --some-flag (boolean)
    // -x (short boolean)

    let optionName: string | null = null;
    let optionValue: string | boolean = true;

    if (line.startsWith("--")) {
      // Long option
      const spaceIndex = line.indexOf(" ");
      if (spaceIndex === -1) {
        // Boolean flag (no value)
        optionName = line.substring(2);
      } else {
        optionName = line.substring(2, spaceIndex);
        optionValue = line.substring(spaceIndex + 1).trim();
        // Remove surrounding quotes if present
        if (
          (optionValue.startsWith('"') && optionValue.endsWith('"')) ||
          (optionValue.startsWith("'") && optionValue.endsWith("'"))
        ) {
          optionValue = optionValue.slice(1, -1);
        }
      }
    } else if (line.startsWith("-") && !line.startsWith("--")) {
      // Short option
      const parts = line.split(/\s+/);
      optionName = parts[0].substring(1);
      if (parts.length > 1) {
        optionValue = parts.slice(1).join(" ");
        // Remove surrounding quotes if present
        if (
          typeof optionValue === "string" &&
          ((optionValue.startsWith('"') && optionValue.endsWith('"')) ||
            (optionValue.startsWith("'") && optionValue.endsWith("'")))
        ) {
          optionValue = optionValue.slice(1, -1);
        }
      }
    }

    if (optionName) {
      // Convert kebab-case to camelCase for flags object
      const camelCaseName = optionName.replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      );
      flags[camelCaseName] = optionValue;
    }
  }

  return flags;
}

/**
 * Get user's yt-dlp configuration from settings
 * @param url - Optional URL to contextually filter settings (e.g. proxy only for YouTube)
 */
export function getUserYtDlpConfig(url?: string): Record<string, any> {
  try {
    const settings = storageService.getSettings();
    const configText = settings.ytDlpConfig;
    const proxyOnlyYoutube = settings.proxyOnlyYoutube === true;

    if (configText) {
      const parsedConfig = parseYtDlpConfig(configText);
      console.log("Parsed user yt-dlp config:", parsedConfig);

      // If proxy is restricted to YouTube only, and we have a non-YouTube URL
      if (proxyOnlyYoutube && url) {
        const isYoutube =
          url.includes("youtube.com") || url.includes("youtu.be");
        if (!isYoutube) {
          console.log(
            "Proxy restricted to YouTube only. Removing proxy settings for:",
            url
          );
          // Remove proxy-related settings
          delete parsedConfig.proxy;
          // Also remove potentially related network options if they are usually proxy-specific?
          // sticking to just 'proxy' as per request and standard usage.
        }
      }

      return parsedConfig;
    }
  } catch (error) {
    console.error("Error reading user yt-dlp config:", error);
  }
  return {};
}

/**
 * Extract network-related options from user config
 * These are safe to apply to all operations (search, info, download)
 */
export function getNetworkConfigFromUserConfig(
  userConfig: Record<string, any>
): Record<string, any> {
  const networkOptions: Record<string, any> = {};

  // Proxy settings
  if (userConfig.proxy) {
    networkOptions.proxy = userConfig.proxy;
  }

  // Rate limiting
  if (userConfig.r || userConfig.limitRate) {
    networkOptions.limitRate = userConfig.r || userConfig.limitRate;
  }

  // Socket timeout
  if (userConfig.socketTimeout) {
    networkOptions.socketTimeout = userConfig.socketTimeout;
  }

  // Force IPv4/IPv6
  if (userConfig.forceIpv4 || userConfig["4"]) {
    networkOptions.forceIpv4 = true;
  }
  if (userConfig.forceIpv6 || userConfig["6"]) {
    networkOptions.forceIpv6 = true;
  }

  // Geo bypass
  if (userConfig.xff) {
    networkOptions.xff = userConfig.xff;
  }

  // Sleep/rate limiting
  if (userConfig.sleepRequests) {
    networkOptions.sleepRequests = userConfig.sleepRequests;
  }
  if (userConfig.sleepInterval || userConfig.minSleepInterval) {
    networkOptions.sleepInterval =
      userConfig.sleepInterval || userConfig.minSleepInterval;
  }
  if (userConfig.maxSleepInterval) {
    networkOptions.maxSleepInterval = userConfig.maxSleepInterval;
  }

  // Retries
  if (userConfig.retries || userConfig.R) {
    networkOptions.retries = userConfig.retries || userConfig.R;
  }

  return networkOptions;
}

/**
 * Helper to convert a proxy URL string into an Axios config object
 * Supports http/https proxies with authentication
 * Format: http://user:pass@host:port
 */
export function getAxiosProxyConfig(proxyUrl: string): any {
  if (!proxyUrl) return {};

  try {
    const url = new URL(proxyUrl);

    const isHttps = url.protocol === "https:";
    const defaultPort = isHttps ? 443 : 80;

    // Axios proxy config structure
    const proxyConfig: any = {
      protocol: url.protocol.replace(":", ""),
      host: url.hostname,
      port: parseInt(url.port, 10) || defaultPort,
    };

    if (url.username || url.password) {
      proxyConfig.auth = {
        username: url.username,
        password: url.password,
      };
    }

    return { proxy: proxyConfig };
  } catch (error) {
    console.error("Invalid proxy URL:", proxyUrl);
    return {};
  }
}
