/**
 * Configuration management for cloud storage
 */

import { getSettings } from "../storageService";
import { CloudDriveConfig } from "./types";

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
  };
}

/**
 * Check if cloud storage is properly configured
 */
export function isConfigured(config: CloudDriveConfig): boolean {
  return config.enabled && !!config.apiUrl && !!config.token;
}

