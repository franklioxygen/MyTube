/**
 * Types and interfaces for cloud storage operations
 */

export interface CloudDriveConfig {
  enabled: boolean;
  apiUrl: string;
  token: string;
  publicUrl?: string;
  uploadPath: string;
  scanPaths?: string[];
}

export interface CachedSignedUrl {
  url: string;
  timestamp: number;
  expiresAt: number;
}

export interface CachedFileList {
  files: any[];
  timestamp: number;
}

export interface FileWithPath {
  file: any;
  path: string;
}

export interface FileUrlsResult {
  videoUrl?: string;
  thumbnailUrl?: string;
  thumbnailThumbUrl?: string;
}

export interface ScanResult {
  added: number;
  errors: string[];
}

export type FileType = "video" | "thumbnail";

