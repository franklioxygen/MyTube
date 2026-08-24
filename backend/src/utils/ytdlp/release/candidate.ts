import path from "path";
import { getProviderPluginPath } from "../../../services/downloaders/ytdlp/ytdlpHelpers";
import { logger } from "../../logger";
import {
  YT_DLP_HELP_PROBE_TIMEOUT_MS,
  YT_DLP_PIP_PACKAGE,
  YT_DLP_PIP_PROVIDER_PACKAGE,
} from "../constants";
import { captureProcessEnv, buildManagedSpawnEnv } from "./env";
import type { PythonInterpreter } from "./interpreter";
import { assertNotSymlink, chmodQuiet, writeJsonAtomic } from "./paths";
import { MODULE_ORIGIN_SCRIPT } from "./moduleOrigin";
import { runProcess } from "./process";
import {
  RELEASE_JSON_FILENAME,
  SITE_PACKAGES_DIRNAME,
  type ReleaseManifest,
} from "./types";


export async function pipInstallToTarget(
  interpreter: PythonInterpreter,
  targetDir: string,
  timeoutMs: number
): Promise<void> {
  const packages = [YT_DLP_PIP_PACKAGE];
  if (!getProviderPluginPath()) {
    packages.push(YT_DLP_PIP_PROVIDER_PACKAGE);
  }
  logger.info(`[yt-dlp] Installing ${packages.join(", ")} into ${targetDir}`);
  const result = await runProcess(
    interpreter.executable,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-cache-dir",
      "--no-input",
      "--target",
      targetDir,
      ...packages,
    ],
    { timeoutMs }
  );
  if (result.timedOut) {
    throw new Error("pip install timed out while assembling a yt-dlp release");
  }
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().split("\n").pop();
    throw new Error(`pip install failed${detail ? `: ${detail}` : ""}`);
  }
}

/**
 * Run every check that must pass before a candidate can become current: the
 * version and help probes, the impersonation probe (an absent target is a
 * capability, not a failure) and the module-origin check that proves the
 * candidate imports from its own site-packages rather than an ambient install.
 * Only then is release.json written and flushed.
 */
export async function validateStagedRelease(input: {
  interpreter: PythonInterpreter;
  stagingRoot: string;
  sitePackagesPath: string;
  createReleaseId: (version: string) => string;
  installedAt: string;
}): Promise<ReleaseManifest> {
  const { interpreter, stagingRoot, sitePackagesPath, installedAt } = input;
  assertNotSymlink(sitePackagesPath, stagingRoot);
  const env = buildManagedSpawnEnv(sitePackagesPath, captureProcessEnv());
  const prefix = ["-m", "yt_dlp"];

  const versionResult = await runProcess(
    interpreter.executable,
    [...prefix, "--version"],
    { env, timeoutMs: YT_DLP_HELP_PROBE_TIMEOUT_MS }
  );
  if (versionResult.timedOut || versionResult.code !== 0) {
    throw new Error("Candidate yt-dlp --version probe failed");
  }
  const version = (versionResult.stdout || versionResult.stderr).trim();
  if (!version) {
    throw new Error("Candidate yt-dlp did not print a version");
  }

  const helpResult = await runProcess(
    interpreter.executable,
    [...prefix, "--help"],
    { env, timeoutMs: YT_DLP_HELP_PROBE_TIMEOUT_MS }
  );
  if (helpResult.timedOut || helpResult.code !== 0) {
    throw new Error("Candidate yt-dlp --help probe failed");
  }

  const impersonateResult = await runProcess(
    interpreter.executable,
    [...prefix, "--list-impersonate-targets"],
    { env, timeoutMs: YT_DLP_HELP_PROBE_TIMEOUT_MS }
  );
  if (impersonateResult.timedOut) {
    throw new Error("Candidate yt-dlp impersonation probe timed out");
  }

  const allowedOrigins = [sitePackagesPath, getProviderPluginPath()].filter(
    Boolean
  );
  const originResult = await runProcess(
    interpreter.executable,
    ["-c", MODULE_ORIGIN_SCRIPT, ...allowedOrigins],
    { env, timeoutMs: YT_DLP_HELP_PROBE_TIMEOUT_MS }
  );
  if (originResult.timedOut || originResult.code !== 0) {
    throw new Error(
      "Candidate yt-dlp imported modules from outside the managed site-packages"
    );
  }

  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    releaseId: input.createReleaseId(version),
    version,
    installedAt,
    pythonExecutable: interpreter.executable,
    pythonPrefixArgs: [],
    sitePackages: SITE_PACKAGES_DIRNAME,
  };
  writeJsonAtomic(
    path.join(stagingRoot, RELEASE_JSON_FILENAME),
    stagingRoot,
    manifest
  );
  chmodQuiet(path.join(stagingRoot, RELEASE_JSON_FILENAME), 0o600);
  return manifest;
}
