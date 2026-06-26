import { spawn } from "child_process";
import {
  YT_DLP_HELP_PROBE_TIMEOUT_MS,
  YT_DLP_STALE_AFTER_DAYS,
} from "./constants";
import { getYtDlpSpawnEnv } from "./spawnEnv";

export type YtDlpCandidateProbe = {
  canRun: boolean;
  supportsModernJsRuntimes: boolean;
  version: string | null;
  releaseTimestamp: number | null;
  isStale: boolean;
};

export type YtDlpVersionInfo = {
  canRun: boolean;
  version: string | null;
  releaseTimestamp: number | null;
  isStale: boolean;
  errorKind?: "close" | "spawn";
  errorCode?: string;
  errorMessage?: string;
};

function extractYtDlpReleaseTimestamp(versionText: string | null): number | null {
  if (!versionText) {
    return null;
  }

  const match = versionText.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, monthIndex, day);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isYtDlpReleaseStale(releaseTimestamp: number | null): boolean {
  if (releaseTimestamp === null) {
    return false;
  }

  const staleAfterMs = YT_DLP_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - releaseTimestamp > staleAfterMs;
}

export async function getYtDlpVersionInfo(
  ytDlpPath: string
): Promise<YtDlpVersionInfo> {
  let versionText = "";

  return await new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      proc.kill("SIGTERM");
      settled = true;
      resolve({
        canRun: false,
        version: null,
        releaseTimestamp: null,
        isStale: false,
        errorKind: "spawn",
        errorCode: "ETIMEDOUT",
        errorMessage: "yt-dlp version probe timed out",
      });
    }, YT_DLP_HELP_PROBE_TIMEOUT_MS);
    timeout.unref?.();
    const settle = (result: YtDlpVersionInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    // ytDlpPath is either explicitly configured by the operator or selected
    // from enumerated PATH entries and fixed executable names above.
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    const proc = spawn(ytDlpPath, ["--version"], {
      env: getYtDlpSpawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      versionText += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      versionText += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        settle({
          canRun: false,
          version: null,
          releaseTimestamp: null,
          isStale: false,
          errorKind: "close",
        });
        return;
      }

      const normalizedVersion = versionText.trim() || null;
      const releaseTimestamp = extractYtDlpReleaseTimestamp(normalizedVersion);
      settle({
        canRun: true,
        version: normalizedVersion,
        releaseTimestamp,
        isStale: isYtDlpReleaseStale(releaseTimestamp),
      });
    });

    proc.on("error", (error: NodeJS.ErrnoException) => {
      settle({
        canRun: false,
        version: null,
        releaseTimestamp: null,
        isStale: false,
        errorKind: "spawn",
        errorCode: error?.code,
        errorMessage: error?.message,
      });
    });
  });
}

export async function probeYtDlpCandidate(
  ytDlpPath: string
): Promise<YtDlpCandidateProbe> {
  const versionInfo = await getYtDlpVersionInfo(ytDlpPath);
  if (!versionInfo.canRun) {
    return {
      canRun: false,
      supportsModernJsRuntimes: false,
      version: null,
      releaseTimestamp: null,
      isStale: false,
    };
  }

  let helpText = "";

  return await new Promise<YtDlpCandidateProbe>((resolve) => {
    let settled = false;
    const failProbe = (): YtDlpCandidateProbe => ({
      canRun: false,
      supportsModernJsRuntimes: false,
      version: versionInfo.version,
      releaseTimestamp: versionInfo.releaseTimestamp,
      isStale: versionInfo.isStale,
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      proc.kill("SIGTERM");
      settled = true;
      resolve(failProbe());
    }, YT_DLP_HELP_PROBE_TIMEOUT_MS);
    timeout.unref?.();
    const settle = (probe: YtDlpCandidateProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(probe);
    };

    // ytDlpPath is built from PATH entries and a fixed executable name above;
    // shell execution is disabled and arguments are passed separately.
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    const proc = spawn(ytDlpPath, ["--help"], {
      env: getYtDlpSpawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      helpText += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      helpText += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        settle(failProbe());
        return;
      }
      settle({
        canRun: true,
        supportsModernJsRuntimes:
          helpText.includes("--js-runtimes") ||
          helpText.includes("--js-runtime"),
        version: versionInfo.version,
        releaseTimestamp: versionInfo.releaseTimestamp,
        isStale: versionInfo.isStale,
      });
    });

    proc.on("error", () => {
      settle(failProbe());
    });
  });
}

export function isBetterYtDlpCandidate(
  candidate: YtDlpCandidateProbe,
  currentBest: YtDlpCandidateProbe | null
): boolean {
  if (!currentBest) {
    return true;
  }

  if (candidate.isStale !== currentBest.isStale) {
    return currentBest.isStale;
  }

  if (
    candidate.supportsModernJsRuntimes !== currentBest.supportsModernJsRuntimes
  ) {
    return candidate.supportsModernJsRuntimes;
  }

  const candidateTimestamp = candidate.releaseTimestamp ?? 0;
  const bestTimestamp = currentBest.releaseTimestamp ?? 0;
  if (candidateTimestamp !== bestTimestamp) {
    return candidateTimestamp > bestTimestamp;
  }

  return false;
}
