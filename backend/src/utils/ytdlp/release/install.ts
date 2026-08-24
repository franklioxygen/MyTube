import path from "path";
import { ensureDirSafeSync, removeSafe } from "../../security";
import { logger } from "../../logger";
import { YT_DLP_PIP_TIMEOUT_MS } from "../constants";
import { withPipLock } from "../pipLock";
import { pipInstallToTarget, validateStagedRelease } from "./candidate";
import { createOperationId, createReleaseId } from "./ids";
import { discoverPythonInterpreter } from "./interpreter";
import { readCurrentManifest } from "./manifests";
import {
  ensureManagedStoreLayout,
  fsyncDirectory,
  getReleaseDir,
  getStagingDir,
  pathExistsInRoot,
  renameInRoot,
} from "./paths";
import { publishValidatedRelease } from "./publish";
import { SITE_PACKAGES_DIRNAME, type PublishOutcome } from "./types";

let pipTimeoutMs = YT_DLP_PIP_TIMEOUT_MS;

export function setPipTimeoutMsForTests(timeoutMs: number | null): void {
  pipTimeoutMs = timeoutMs ?? YT_DLP_PIP_TIMEOUT_MS;
}

export type InstallManagedReleaseOptions = {
  /** Set when the current release was found not to run and must be replaced. */
  currentIsUsable?: boolean;
};

export async function installManagedRelease(
  options: InstallManagedReleaseOptions = {}
): Promise<PublishOutcome> {
  return withPipLock(() => installManagedReleaseLocked(options));
}

async function installManagedReleaseLocked(
  options: InstallManagedReleaseOptions
): Promise<PublishOutcome> {
  const layout = ensureManagedStoreLayout();
  const generationAtInstallStart =
    readCurrentManifest(layout.root)?.generation ?? null;
  const interpreter = await discoverPythonInterpreter();
  const operationId = createOperationId();
  const stagingRoot = getStagingDir(layout, operationId);
  const sitePackagesPath = path.join(stagingRoot, SITE_PACKAGES_DIRNAME);
  ensureDirSafeSync(sitePackagesPath, layout.root);
  logger.info(
    `[yt-dlp] ${operationId}: staging a candidate release in ${stagingRoot}`
  );

  try {
    await pipInstallToTarget(interpreter, sitePackagesPath, pipTimeoutMs);
    const validated = await validateStagedRelease({
      interpreter,
      stagingRoot,
      sitePackagesPath,
      // The id is derived from the version the candidate actually reports, so
      // a release directory names the release it holds.
      createReleaseId,
      installedAt: new Date().toISOString(),
    });
    logger.info(
      `[yt-dlp] ${operationId}: candidate ${validated.version} validated as ${validated.releaseId}`
    );
    const releaseDir = getReleaseDir(layout, validated.releaseId);
    if (pathExistsInRoot(releaseDir, layout.root)) {
      throw new Error(
        `Managed yt-dlp release id collided: ${validated.releaseId}`
      );
    }
    // After this rename the directory is immutable; nothing writes into it.
    renameInRoot(stagingRoot, releaseDir, layout.root);
    // A rename is not durable until its parent directory is. current.json's
    // parent is flushed when the pointer is replaced, so without this a crash
    // could leave a surviving pointer naming a release whose directory entry
    // was lost - turning a completed update into a silent rollback.
    fsyncDirectory(layout.releasesDir);
    logger.info(
      `[yt-dlp] ${operationId}: finalized release ${validated.releaseId}`
    );
    return await publishValidatedRelease({
      releaseId: validated.releaseId,
      version: validated.version,
      generationAtInstallStart,
      currentIsUsable: options.currentIsUsable,
    });
  } catch (error: unknown) {
    await removeSafe(stagingRoot, layout.root).catch(() => undefined);
    logger.warn(
      `[yt-dlp] ${operationId}: managed release install failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  }
}
