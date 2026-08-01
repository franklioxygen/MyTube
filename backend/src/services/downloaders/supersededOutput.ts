import path from "path";
import { resolveManagedWebPath } from "../filenameTemplate/pathHelpers";
import { resolveSafeChildPath } from "../../utils/security";

/**
 * Resolves the previous managed file a redownload has superseded, or null when
 * nothing should be removed.
 *
 * A filename-template or authorOrganizationMode change moves a redownload to a
 * new path, after which the row points elsewhere and the old file is left
 * unreferenced — a leak the collision audit cannot report. Comparing basenames
 * misses that entirely, because an organization change keeps the basename and
 * only changes the directory.
 *
 * Comparing resolved absolute paths catches the directory-only case and, just as
 * importantly, guarantees an in-place replacement is never selected: when the
 * previous path is the file that was just written, this returns null.
 */
export function resolveSupersededManagedPath(input: {
  previousWebPath?: string | null;
  previousFilename?: string | null;
  fallbackRootDir: string;
  newAbsolutePath: string;
}): string | null {
  const resolved = input.previousWebPath
    ? resolveManagedWebPath(input.previousWebPath)
    : null;
  const previousPath = resolved
    ? resolved.absolutePath
    : input.previousFilename
      ? resolveSafeChildPath(input.fallbackRootDir, input.previousFilename)
      : null;

  if (!previousPath) {
    return null;
  }

  return path.normalize(previousPath) !== path.normalize(input.newAbsolutePath)
    ? previousPath
    : null;
}
