import { logger } from "../../logger";
import { isValidReleaseId } from "./ids";
import {
  loadManagedRelease,
  readCurrentManifest,
  readPublishedManifest,
  readReleaseManifest,
} from "./manifests";
import { getManagedStoreLayout, listSafeDirNames } from "./paths";
import { YT_DLP_HELP_PROBE_TIMEOUT_MS } from "../constants";
import { buildManagedSpawnEnv, captureProcessEnv } from "./env";
import { runProcess } from "./process";
import { MODULE_ORIGIN_SCRIPT } from "./moduleOrigin";
import { getProviderPluginPath } from "../../../services/downloaders/ytdlp/ytdlpHelpers";
import type { CurrentManifest, LoadedManagedRelease } from "./types";

/**
 * Pick the release the store says is current, falling back through the
 * previous pointer and then the newest finalized release.
 *
 * A managed store that cannot be read at all (unwritable subtree, symlinked
 * directories, unexpected content) must never stop the backend from serving:
 * every failure degrades to external discovery instead of propagating.
 */
/**
 * Releases this process has proven cannot run. Acquisition must skip them, or
 * it would keep re-selecting a release that availability already rejected and
 * fell back from - existence checks alone cannot tell the difference.
 */
const unusableReleaseIds = new Set<string>();

export function markManagedReleaseUnusable(releaseId: string): void {
  unusableReleaseIds.add(releaseId);
}

export function isManagedReleaseUnusable(releaseId: string): boolean {
  return unusableReleaseIds.has(releaseId);
}

/** "runs" and "broken" describe the release; "unknown" describes the probe. */
type ReleaseHealth = "runs" | "broken" | "unknown";

const runnableReleaseIds = new Map<string, Promise<boolean>>();

export function resetUnusableManagedReleasesForTests(): void {
  unusableReleaseIds.clear();
  runnableReleaseIds.clear();
}

/**
 * Memoized form of {@link managedReleaseRuns}. A release is immutable, so one
 * definitive answer per release id is enough — which is what makes it
 * affordable for the status endpoint and the operator update path, not just
 * execution. Only definitive answers are cached.
 */
export function managedReleaseRunsCached(
  loaded: LoadedManagedRelease
): Promise<boolean> {
  const cached = runnableReleaseIds.get(loaded.release.releaseId);
  if (cached) {
    return cached;
  }
  const pending = managedReleaseRuns(loaded).then((health) => {
    if (health === "broken") {
      markManagedReleaseUnusable(loaded.release.releaseId);
      return false;
    }
    if (health === "unknown") {
      // Nothing was learned, so nothing is remembered: the next caller probes
      // again rather than inheriting one transient failure for the process
      // lifetime. Optimistic in the meantime - execution surfaces a genuinely
      // broken release on its own.
      runnableReleaseIds.delete(loaded.release.releaseId);
    }
    return true;
  });
  runnableReleaseIds.set(loaded.release.releaseId, pending);
  return pending;
}

export function recoverUsableManagedRelease(
  root?: string
): LoadedManagedRelease | null {
  try {
    return recoverUsableManagedReleaseUnsafe(root ?? getManagedStoreLayout().root);
  } catch (error: unknown) {
    logger.warn(
      `[yt-dlp] Managed release store is unusable, falling back to discovery: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

function recoverUsableManagedReleaseUnsafe(
  root: string
): LoadedManagedRelease | null {
  const current = readCurrentManifest(root);
  if (current) {
    const loaded = unusableReleaseIds.has(current.releaseId)
      ? null
      : loadManagedRelease(current.releaseId, current, root);
    if (loaded) {
      return loaded;
    }
    logger.warn(
      `[yt-dlp] Current managed release ${current.releaseId} failed validation; trying the previous release.`
    );
    if (
      current.previousReleaseId &&
      !unusableReleaseIds.has(current.previousReleaseId)
    ) {
      const previous = loadManagedRelease(
        current.previousReleaseId,
        current,
        root
      );
      if (previous) {
        logger.info(
          `[yt-dlp] Recovered managed release ${previous.release.releaseId} from previousReleaseId.`
        );
        return previous;
      }
    }
  }
  return loadNewestFinalizedRelease(current, root);
}

function loadNewestFinalizedRelease(
  current: CurrentManifest | null,
  root: string
): LoadedManagedRelease | null {
  const layout = getManagedStoreLayout(root);
  const published: Array<{
    releaseId: string;
    generation: number;
    publishedAt: number;
  }> = [];
  const legacy: Array<{ releaseId: string; installedAt: number }> = [];
  for (const name of listSafeDirNames(layout.releasesDir, layout.root)) {
    if (!isValidReleaseId(name)) {
      continue;
    }
    const manifest = readReleaseManifest(name, layout.root);
    if (!manifest || unusableReleaseIds.has(name)) {
      continue;
    }
    const publication = readPublishedManifest(name, layout.root);
    if (publication) {
      published.push({
        releaseId: name,
        generation: publication.generation,
        publishedAt: Date.parse(publication.publishedAt),
      });
      continue;
    }
    legacy.push({
      releaseId: name,
      installedAt: Date.parse(manifest.installedAt) || 0,
    });
  }
  // Once this store has publication records, only releases carrying one are
  // eligible. Falling back to every finalized directory would reintroduce
  // conflict-rejected candidates. The legacy path exists only for stores that
  // predate publication records entirely.
  const candidates = published.length
    ? published.sort(
        (a, b) => b.generation - a.generation || b.publishedAt - a.publishedAt
      )
    : legacy.sort((a, b) => b.installedAt - a.installedAt);
  for (const candidate of candidates) {
    const loaded = loadManagedRelease(candidate.releaseId, current, root);
    if (loaded) {
      return loaded;
    }
  }
  return null;
}

/**
 * Prove a persisted release can still actually run.
 *
 * Existence checks are not enough: a store that outlives an image or host
 * upgrade can keep a valid interpreter path and a populated site-packages
 * whose native dependencies no longer match the new Python ABI, and storage
 * corruption can leave the directory present but unusable. Without this the
 * backend would keep selecting a release on which every invocation fails,
 * instead of falling through to another release or reinstalling.
 *
 * Deliberately not called per acquisition - it spawns a process. Callers run
 * it once, where availability is established.
 */
export async function managedReleaseRuns(
  loaded: LoadedManagedRelease
): Promise<ReleaseHealth> {
  // Not `-m yt_dlp --version`: PYTHONNOUSERSITE only disables the *user* site,
  // and the image installs yt-dlp globally, so a release whose site-packages
  // lost yt_dlp would import the image-wide copy and report success. Status
  // would then show the manifest's version while executions silently ran a
  // different one. The origin probe answers "does this release run" and "is it
  // actually this release" together, and is the same check publication uses.
  const allowedOrigins = [
    loaded.sitePackagesPath,
    getProviderPluginPath(),
  ].filter(Boolean);
  const result = await runProcess(
    loaded.release.pythonExecutable,
    [...loaded.release.pythonPrefixArgs, "-c", MODULE_ORIGIN_SCRIPT, ...allowedOrigins],
    {
      env: buildManagedSpawnEnv(loaded.sitePackagesPath, captureProcessEnv()),
      timeoutMs: YT_DLP_HELP_PROBE_TIMEOUT_MS,
    }
  );
  if (result.code === 0) {
    return "runs";
  }
  // A probe that never produced an answer - a timeout, or a spawn that failed
  // under resource pressure - describes the machine, not the release. Treating
  // it as a verdict would permanently condemn a healthy release and force an
  // unnecessary reinstall or rollback.
  if (result.timedOut || result.code === null) {
    return "unknown";
  }
  return "broken";
}
