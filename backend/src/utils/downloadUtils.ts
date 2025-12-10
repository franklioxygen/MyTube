/**
 * Utility functions for download operations
 */

/**
 * Parse size string (e.g., "10.00MiB", "123.45KiB") to bytes
 * Handles both decimal (KB, MB, GB, TB) and binary (KiB, MiB, GiB, TiB) units
 * Also handles ~ prefix for approximate sizes
 */
export function parseSize(sizeStr: string): number {
  if (!sizeStr) return 0;

  // Remove ~ prefix if present
  const cleanSize = sizeStr.replace(/^~/, "").trim();

  // Match number and unit
  const match = cleanSize.match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers: { [key: string]: number } = {
    B: 1,
    KB: 1000,
    KIB: 1024,
    MB: 1000 * 1000,
    MIB: 1024 * 1024,
    GB: 1000 * 1000 * 1000,
    GIB: 1024 * 1024 * 1024,
    TB: 1000 * 1000 * 1000 * 1000,
    TIB: 1024 * 1024 * 1024 * 1024,
  };

  return value * (multipliers[unit] || 1);
}

/**
 * Format bytes to human readable string (e.g., "55.8 MiB")
 * Uses binary units (KiB, MiB, GiB, TiB) with 1024 base
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Calculate downloaded size from progress percentage and total size
 * Returns formatted string (e.g., "55.8 MiB")
 */
export function calculateDownloadedSize(
  percentage: number,
  totalSize: string
): string {
  if (!totalSize || totalSize === "?") return "0 B";
  const totalBytes = parseSize(totalSize);
  const downloadedBytes = (percentage / 100) * totalBytes;
  return formatBytes(downloadedBytes);
}
