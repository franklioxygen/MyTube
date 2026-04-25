import { spawn } from "child_process";
import path from "path";
import { PassThrough } from "stream";
import { DATA_DIR } from "../config/paths";
import { isBilibiliUrl } from "./helpers";
import {
  moveSafeSync,
  pathExistsSafeSync,
  resolveSafeChildPath,
} from "./security";
import { flagsToArgs, withDefaultYouTubeExtractorArgs } from "./ytDlp/flags";
import {
  YT_DLP_PATH,
  appendYouTubeJsRuntimeArg,
  ensureYtDlpAvailable,
} from "./ytDlp/runtime";

export { convertFlagToArg, flagsToArgs } from "./ytDlp/flags";
export {
  YT_DLP_PATH,
  ensureYtDlpAvailable,
  resetYtDlpAvailabilityCacheForTests,
} from "./ytDlp/runtime";
export {
  InvalidProxyError,
  getAxiosProxyConfig,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  parseYtDlpConfig,
} from "./ytDlp/config";

const COOKIES_PATH = path.join(DATA_DIR, "cookies.txt");

/**
 * Preprocess URL to handle specific domain replacements
 * e.g. xvideos.red -> xvideos.com to support yt-dlp extraction
 */
function preprocessUrl(url: string): string {
  if (!url) return url;
  
  // Handle XVideos mirrors
  if (url.includes("xvideos.red")) {
    console.log(`Preprocessing URL: replacing xvideos.red with xvideos.com`);
    return url.replace("xvideos.red", "xvideos.com");
  }
  
  return url;
}

/**
 * Get cookies file path if it exists
 */
function getCookiesPath(): string | null {
  if (pathExistsSafeSync(COOKIES_PATH, DATA_DIR)) {
    return COOKIES_PATH;
  }
  return null;
}

/**
 * Execute yt-dlp with JSON output and return parsed result
 * @param url - Video URL
 * @param flags - yt-dlp flags
 * @param retryWithoutFormatRestrictions - If true, retry without format restrictions if format error occurs
 */
export async function executeYtDlpJson(
  rawUrl: string,
  flags: Record<string, any> = {},
  retryWithoutFormatRestrictions: boolean = true
): Promise<any> {
  await ensureYtDlpAvailable();
  const url = preprocessUrl(rawUrl);
  const effectiveFlags = withDefaultYouTubeExtractorArgs(url, flags);
  const { noWarnings: _noWarnings, ...jsonFlags } = effectiveFlags;
  const args = [
    "--dump-single-json",
    "--no-warnings",
    ...flagsToArgs(jsonFlags),
  ];

  // Add cookies if file exists
  const cookiesPath = getCookiesPath();
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  await appendYouTubeJsRuntimeArg(args, url);

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
            (effectiveFlags.formatSort !== undefined &&
              effectiveFlags.formatSort !== null) ||
            (effectiveFlags.format !== undefined &&
              effectiveFlags.format !== null) ||
            (effectiveFlags.S !== undefined && effectiveFlags.S !== null) ||
            (effectiveFlags.f !== undefined && effectiveFlags.f !== null);

          if (hasFormatRestrictions) {
            console.log(
              "Format not available, retrying without format restrictions and with --ignore-config..."
            );
            try {
              // Remove format-related flags
              const retryFlags: Record<string, any> = {
                ...effectiveFlags,
                ignoreConfig: true,
              };
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
          } else if (!effectiveFlags.ignoreConfig) {
            console.log(
              "Format not available without explicit format flags, retrying with --ignore-config..."
            );
            try {
              const retryFlags: Record<string, any> = {
                ...effectiveFlags,
                ignoreConfig: true,
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
 * Get channel URL from a video URL
 * Uses: yt-dlp <video_url> --print channel_url --skip-download
 */
export async function getChannelUrlFromVideo(
  videoUrlRaw: string,
  networkConfig: Record<string, any> = {}
): Promise<string | null> {
  try {
    await ensureYtDlpAvailable();
  } catch (error) {
    // Swallow availability errors: channel URL is supplementary metadata, not critical.
    // Callers treat null as "not found", which is the correct fallback behavior here.
    console.warn("yt-dlp unavailable when fetching channel URL:", error);
    return null;
  }

  const videoUrl = preprocessUrl(videoUrlRaw);
  const args = [
    "--print",
    "channel_url",
    "--skip-download",
    "--no-warnings",
    ...flagsToArgs(networkConfig),
  ];

  // Add cookies if file exists
  const cookiesPath = getCookiesPath();
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  await appendYouTubeJsRuntimeArg(args, videoUrl);

  args.push(videoUrl);

  return new Promise<string | null>((resolve, reject) => {
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

    subprocess.on("close", (code) => {
      if (code !== 0) {
        console.warn(`Failed to get channel URL: ${stderr}`);
        resolve(null);
        return;
      }

      const channelUrl = stdout.trim();
      resolve(channelUrl || null);
    });

    subprocess.on("error", (error) => {
      console.warn(`Error getting channel URL:`, error);
      resolve(null);
    });
  });
}

/**
 * Download channel avatar/thumbnail from channel URL
 * Uses: yt-dlp <channel_url> --write-thumbnail --playlist-items 0 -o <output_path>
 */
export async function downloadChannelAvatar(
  channelUrlRaw: string,
  outputPath: string,
  networkConfig: Record<string, any> = {}
): Promise<boolean> {
  try {
    await ensureYtDlpAvailable();
  } catch (error) {
    // Swallow availability errors: avatar download failures are non-fatal.
    // Callers treat false as "avatar unavailable" and continue without it.
    console.warn("yt-dlp unavailable when downloading channel avatar:", error);
    return false;
  }

  const channelUrl = preprocessUrl(channelUrlRaw);
  const outputDir = path.dirname(outputPath);
  const outputFilename = path.basename(outputPath, path.extname(outputPath));
  const outputTemplate = resolveSafeChildPath(
    outputDir,
    `${outputFilename}.%(ext)s`
  );

  const args = [
    "--write-thumbnail",
    "--playlist-items",
    "0",
    "--skip-download",
    "--no-warnings",
    "--output",
    outputTemplate,
    ...flagsToArgs(networkConfig),
  ];

  // Add cookies if file exists
  const cookiesPath = getCookiesPath();
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  await appendYouTubeJsRuntimeArg(args, channelUrl);

  args.push(channelUrl);

  return new Promise<boolean>((resolve, reject) => {
    const subprocess = spawn(YT_DLP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    subprocess.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    subprocess.on("close", (code) => {
      if (code !== 0) {
        console.warn(`Failed to download channel avatar: ${stderr}`);
        // For Bilibili, this might be expected - log but don't fail completely
        if (isBilibiliUrl(channelUrl)) {
          console.warn(`Bilibili channel avatar download may not be supported by yt-dlp`);
        }
        resolve(false);
        return;
      }

      // Check if the file was created (yt-dlp might save with different extension)
      const possibleExtensions = ["jpg", "jpeg", "png", "webp"];
      let foundFile = false;
      for (const ext of possibleExtensions) {
        const possiblePath = resolveSafeChildPath(
          outputDir,
          `${outputFilename}.${ext}`
        );
        if (pathExistsSafeSync(possiblePath, outputDir)) {
          // If it's not a jpg, rename it to jpg
          if (ext !== "jpg" && outputPath.endsWith(".jpg")) {
            try {
              moveSafeSync(possiblePath, outputDir, outputPath, outputDir, {
                overwrite: true,
              });
            } catch (error) {
              console.warn(`Failed to rename avatar to .jpg:`, error);
              // If rename fails, just use the original file
              resolve(true);
              return;
            }
          } else if (ext !== "jpg") {
            // File exists but with different extension - that's okay, we'll handle it
            resolve(true);
            return;
          }
          foundFile = true;
          break;
        }
      }

      // If no file found, check if outputPath exists (might have been created directly)
      if (pathExistsSafeSync(outputPath, outputDir)) {
        resolve(true);
        return;
      }

      if (!foundFile) {
        console.warn(`Channel avatar file not found after download. Checked extensions: ${possibleExtensions.join(", ")}`);
        console.warn(`Output directory: ${outputDir}, Output filename: ${outputFilename}`);
      }
      resolve(foundFile);
    });

    subprocess.on("error", (error) => {
      console.warn(`Error downloading channel avatar:`, error);
      resolve(false);
    });
  });
}

/**
 * Execute yt-dlp with spawn for progress tracking.
 * Returns a subprocess-like object with kill() method.
 *
 * Uses PassThrough streams so the actual spawn can be deferred until
 * ensureYtDlpAvailable() confirms (and auto-installs) yt-dlp.
 */
export function executeYtDlpSpawn(
  rawUrl: string,
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
  const url = preprocessUrl(rawUrl);
  const baseArgs = [...flagsToArgs(flags)];

  // Add cookies if file exists
  const cookiesPath = getCookiesPath();
  if (cookiesPath) {
    baseArgs.push("--cookies", cookiesPath);
  }

  // PassThrough streams let callers attach handlers before the subprocess starts.
  const stdoutPass = new PassThrough();
  const stderrPass = new PassThrough();

  let activeSubprocess: ReturnType<typeof spawn> | null = null;
  let killRequested = false;
  let killSignal: NodeJS.Signals | undefined;
  let resolved = false;
  let rejected = false;
  let stderr = "";

  const endPassThroughStreams = () => {
    if (!stdoutPass.destroyed && !stdoutPass.readableEnded) {
      stdoutPass.end();
    }
    if (!stderrPass.destroyed && !stderrPass.readableEnded) {
      stderrPass.end();
    }
  };

  const pipeOrForward = (
    source: NodeJS.ReadableStream | null | undefined,
    target: PassThrough
  ) => {
    if (!source) {
      target.end();
      return;
    }

    if (typeof (source as any).pipe === "function") {
      source.pipe(target, { end: true });
      return;
    }

    // Fallback used by tests that mock child streams as plain EventEmitters.
    source.on("data", (chunk: Buffer | string) => target.write(chunk));
    source.on("end", () => target.end());
  };

  // Accumulate stderr for error reporting (callers may also attach their own handlers).
  stderrPass.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  const promise = ensureYtDlpAvailable()
    .then(
      async () => {
        const args = [...baseArgs];
        await appendYouTubeJsRuntimeArg(args, url);
        args.push(url);

        console.log(`Spawning: ${YT_DLP_PATH} ${args.join(" ")}`);

        return await new Promise<void>((resolve, reject) => {
          if (killRequested) {
            rejected = true;
            endPassThroughStreams();
            const error = new Error("yt-dlp process cancelled before start");
            (error as any).code = "SIGTERM";
            reject(error);
            return;
          }

          activeSubprocess = spawn(YT_DLP_PATH, args, {
            stdio: ["ignore", "pipe", "pipe"],
          });

          pipeOrForward(activeSubprocess.stdout, stdoutPass);
          pipeOrForward(activeSubprocess.stderr, stderrPass);

          // Cancellation might happen between availability check and spawn.
          if (killRequested && !activeSubprocess.killed) {
            activeSubprocess.kill(killSignal);
          }

          activeSubprocess.on("close", (code) => {
            if (!resolved && !rejected) {
              if (code === 0) {
                resolved = true;
                resolve();
              } else {
                rejected = true;
                const error = new Error(
                  `yt-dlp process exited with code ${code}`
                );
                (error as any).stderr = stderr;
                (error as any).code = code;
                console.error("yt-dlp error output:", stderr);
                reject(error);
              }
            }
          });

          activeSubprocess.on("error", (error) => {
            if (!resolved && !rejected) {
              rejected = true;
              reject(error);
            }
          });
        });
      }
    )
    .catch((err) => {
      // End streams without emitting stream "error" events that callers don't subscribe to.
      endPassThroughStreams();
      throw err;
    });

  return {
    stdout: stdoutPass,
    stderr: stderrPass,
    kill: (signal?: NodeJS.Signals) => {
      killRequested = true;
      killSignal = signal;
      if (activeSubprocess && !activeSubprocess.killed) {
        return activeSubprocess.kill(signal);
      }
      // Allow cancelling before spawn starts.
      return activeSubprocess === null ? true : false;
    },
    then: promise.then.bind(promise),
  };
}
