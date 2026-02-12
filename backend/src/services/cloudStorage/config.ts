/**
 * Configuration management for cloud storage
 */

import { getSettings } from "../storageService";
import { CloudDriveConfig } from "./types";

function parseCloudDriveScanPaths(value: unknown): string[] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const scanPaths = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.startsWith("/"));

  return scanPaths.length > 0 ? scanPaths : undefined;
}

/**
 * Get cloud drive configuration from settings
 */
export function getConfig(): CloudDriveConfig {
  const settings = getSettings();

  return {
    enabled: settings.cloudDriveEnabled || false,
    apiUrl: settings.openListApiUrl || "",
    token: settings.openListToken || "",
    publicUrl: settings.openListPublicUrl || undefined,
    uploadPath: settings.cloudDrivePath || "/",
    scanPaths: parseCloudDriveScanPaths(settings.cloudDriveScanPaths),
  };
}

/**
 * Check if cloud storage is properly configured
 */
export function isConfigured(config: CloudDriveConfig): boolean {
  return config.enabled && !!config.apiUrl && !!config.token;
}
