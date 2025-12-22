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
  
  // Parse scan paths from multi-line string
  let scanPaths: string[] | undefined = undefined;
  if (settings.cloudDriveScanPaths) {
    scanPaths = settings.cloudDriveScanPaths
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && line.startsWith('/'));
    
    // If no valid paths found, set to undefined
    if (scanPaths && scanPaths.length === 0) {
      scanPaths = undefined;
    }
  }
  
  return {
    enabled: settings.cloudDriveEnabled || false,
    apiUrl: settings.openListApiUrl || "",
    token: settings.openListToken || "",
    publicUrl: settings.openListPublicUrl || undefined,
    uploadPath: settings.cloudDrivePath || "/",
    scanPaths: scanPaths,
  };
}

/**
 * Check if cloud storage is properly configured
 */
export function isConfigured(config: CloudDriveConfig): boolean {
  return config.enabled && !!config.apiUrl && !!config.token;
}

