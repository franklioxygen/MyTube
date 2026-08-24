import { logger } from "../../logger";
import {
  YT_DLP_HELP_PROBE_TIMEOUT_MS,
  type YouTubeJsRuntimeFlag,
} from "../constants";
import { runProcess } from "./process";
import type { YtDlpCapabilities, YtDlpRelease } from "./types";

const capabilityCache = new Map<string, Promise<YtDlpCapabilities>>();

export function resetCapabilityCacheForTests(): void {
  capabilityCache.clear();
}

export function getReleaseCapabilities(
  release: YtDlpRelease
): Promise<YtDlpCapabilities> {
  if (release.kind === "external") {
    return probeCapabilitiesWithLogging(release);
  }
  const cached = capabilityCache.get(release.releaseId);
  if (cached) {
    return cached;
  }
  const pending = probeCapabilitiesWithLogging(release).catch(
    (error: unknown) => {
      // Probe-infrastructure failure: drop the entry so a later acquisition can
      // retry this release instead of inheriting one transient timeout forever.
      capabilityCache.delete(release.releaseId);
      throw error;
    }
  );
  capabilityCache.set(release.releaseId, pending);
  return pending;
}

async function probeCapabilitiesWithLogging(
  release: YtDlpRelease
): Promise<YtDlpCapabilities> {
  try {
    return await probeCapabilities(release);
  } catch (error: unknown) {
    logger.warn(
      `[yt-dlp] Capability probe failed for ${release.releaseId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  }
}

async function probeCapabilities(
  release: YtDlpRelease
): Promise<YtDlpCapabilities> {
  // Two failure kinds must not be confused. A probe that ran to completion and
  // reported "no" describes the immutable release and is cached for its
  // lifetime. A probe that never produced an answer (timeout, spawn failure)
  // says nothing about the release, so it rejects and evicts the cache entry so
  // a later acquisition retries instead of disabling the feature forever.
  const help = await runYtDlp(release, ["--help"]);
  const helpText = `${help.stdout}\n${help.stderr}`.trim();
  if (help.timedOut || help.code === null || !helpText) {
    throw new Error(
      `yt-dlp --help probe did not complete for ${release.releaseId}`
    );
  }

  const impersonate = await runYtDlp(release, ["--list-impersonate-targets"]);
  if (impersonate.timedOut || impersonate.code === null) {
    throw new Error(
      `yt-dlp impersonation probe did not complete for ${release.releaseId}`
    );
  }

  return {
    jsRuntimeFlag: parseJsRuntimeFlag(helpText),
    supportsRemoteComponents: helpText.includes("--remote-components"),
    // A non-zero exit means this yt-dlp has no --list-impersonate-targets at
    // all: definitive absence, not a probe failure.
    impersonateAvailable:
      impersonate.code === 0 &&
      parseImpersonateAvailable(`${impersonate.stdout}\n${impersonate.stderr}`),
  };
}

async function runYtDlp(release: YtDlpRelease, args: string[]) {
  return runProcess(release.command, [...release.prefixArgs, ...args], {
    env: release.spawnEnv,
    timeoutMs: YT_DLP_HELP_PROBE_TIMEOUT_MS,
  });
}

function parseJsRuntimeFlag(helpText: string): YouTubeJsRuntimeFlag | null {
  if (helpText.includes("--js-runtimes")) {
    return "--js-runtimes";
  }
  if (helpText.includes("--js-runtime")) {
    return "--js-runtime";
  }
  return null;
}

function parseImpersonateAvailable(output: string): boolean {
  return output.split("\n").some(
    (line) =>
      /chrome/i.test(line) &&
      /curl_cffi/.test(line) &&
      !/unavailable/i.test(line)
  );
}

export function attachCapabilities(
  release: Omit<YtDlpRelease, "capabilities">
): YtDlpRelease {
  const wrapped = { ...release } as YtDlpRelease;
  let snapshotCapabilities: Promise<YtDlpCapabilities> | null = null;
  Object.defineProperty(wrapped, "capabilities", {
    configurable: true,
    // Non-enumerable on purpose: reading this property probes the release with
    // real child processes. An incidental spread, JSON.stringify, or object
    // logging of a release must never launch one.
    enumerable: false,
    get() {
      // External installations are mutable without their path or version
      // changing (for example, curl_cffi may be added later). Cache only for
      // this acquired snapshot; a later acquisition gets a fresh probe.
      snapshotCapabilities ??= getReleaseCapabilities(wrapped);
      return snapshotCapabilities;
    },
  });
  return wrapped;
}
