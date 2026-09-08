import path from "path";
import { VIDEOS_DIR } from "../config/paths";
import { lstatSafeSync, readFileSafeSync, resolveSafeChildPath, writeFileSafeSync } from "../utils/security";

export const DOWNLOAD_TEMP_MARKER = ".mytube-download.json";
const tempNamePattern = /^temp_\d{13}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const activeDirectories = new Set<string>();

/** Persist ownership so a subsequent process can recognize abandoned jobs. */
export function registerDownloadTempDir(directory: string): void {
  const marker = resolveSafeChildPath(directory, DOWNLOAD_TEMP_MARKER);
  writeFileSafeSync(marker, VIDEOS_DIR, JSON.stringify({
    owner: "mytube-bilibili", version: 1, directory: path.basename(directory),
  }), { flag: "wx" });
  activeDirectories.add(directory);
}

export function releaseDownloadTempDir(directory: string): void {
  activeDirectories.delete(directory);
}

export function isActiveDownloadTempDir(directory: string): boolean {
  return activeDirectories.has(directory);
}

export function isOwnedInactiveDownloadTempDir(directory: string): boolean {
  if (path.dirname(directory) !== VIDEOS_DIR || !tempNamePattern.test(path.basename(directory)) ||
      activeDirectories.has(directory)) return false;
  try {
    const marker = resolveSafeChildPath(directory, DOWNLOAD_TEMP_MARKER);
    const stat = lstatSafeSync(marker, VIDEOS_DIR);
    if (!stat.isFile() || stat.size > 1024) return false;
    const data = JSON.parse(readFileSafeSync(marker, VIDEOS_DIR, "utf8"));
    return data.owner === "mytube-bilibili" && data.version === 1 && data.directory === path.basename(directory);
  } catch {
    return false;
  }
}
