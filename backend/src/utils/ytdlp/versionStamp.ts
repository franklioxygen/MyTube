/**
 * Parse a yt-dlp release date out of a version string. Accepts both the
 * zero-padded form the binary prints ("2026.08.19") and the PyPI form
 * ("2026.8.19"). Returns null for nightly/unknown formats.
 */
export function parseYtDlpReleaseTimestamp(
  version: string | null | undefined
): number | null {
  if (!version) {
    return null;
  }

  const match = version.trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!match) {
    return null;
  }

  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Compare an installed version against the latest published one. Unknown or
 * unparsable versions never claim an update is available, so the UI stays quiet
 * instead of nagging about a version it cannot reason about.
 */
export function isYtDlpUpdateAvailable(
  installedVersion: string | null,
  latestVersion: string | null
): boolean {
  const installed = parseYtDlpReleaseTimestamp(installedVersion);
  const latest = parseYtDlpReleaseTimestamp(latestVersion);
  if (installed === null || latest === null) {
    return false;
  }
  return latest > installed;
}
