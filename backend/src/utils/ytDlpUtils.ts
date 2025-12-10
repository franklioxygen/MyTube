import { spawn } from "child_process";

const YT_DLP_PATH = process.env.YT_DLP_PATH || "yt-dlp";

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
 */
export async function executeYtDlpJson(
  url: string,
  flags: Record<string, any> = {}
): Promise<any> {
  const args = [
    "--dump-single-json",
    "--no-warnings",
    ...flagsToArgs(flags),
    url,
  ];

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

    subprocess.on("close", (code) => {
      if (code !== 0) {
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
  const args = [...flagsToArgs(flags), url];

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
