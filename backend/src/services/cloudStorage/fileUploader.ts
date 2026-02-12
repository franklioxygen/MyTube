/**
 * File upload operations for cloud storage
 */

import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { FileError, NetworkError } from "../../errors/DownloadErrors";
import { logger } from "../../utils/logger";
import { getFileList } from "./fileLister";
import { normalizeUploadPath } from "./pathUtils";
import { CloudDriveConfig } from "./types";

/**
 * Upload result indicating whether file was actually uploaded or skipped
 */
export interface UploadResult {
  uploaded: boolean;
  skipped: boolean;
  reason?: string;
}

/**
 * Check if a file already exists in cloud storage
 * @param fileName - Name of the file to check
 * @param fileSize - Size of the file in bytes
 * @param destinationPath - Full destination path in cloud storage
 * @param config - Cloud drive configuration
 * @returns true if file exists with same name and size
 */
async function fileExistsInCloud(
  fileName: string,
  fileSize: number,
  destinationPath: string,
  config: CloudDriveConfig
): Promise<boolean> {
  try {
    // Get the directory path from destination path
    const dirPath = path.dirname(destinationPath);
    const normalizedDirPath = normalizeUploadPath(dirPath);

    // Get file list from OpenList
    const files = await getFileList(config, normalizedDirPath);

    // Check if file with same name and size exists
    const existingFile = files.find(
      (file) => file.name === fileName && file.size === fileSize && !file.is_dir
    );

    if (existingFile) {
      logger.info(
        `[CloudStorage] File ${fileName} already exists in cloud storage with same size (${fileSize} bytes), skipping upload`
      );
      return true;
    }

    return false;
  } catch (error) {
    logger.warn(
      `[CloudStorage] Failed to check if file exists in cloud storage:`,
      error instanceof Error ? error : new Error(String(error))
    );
    // If check fails, proceed with upload to be safe
    return false;
  }
}

/**
 * Upload a file to cloud storage
 * @param filePath - Local file path to upload
 * @param config - Cloud drive configuration
 * @param remotePath - Optional remote path (relative to uploadPath)
 * @returns UploadResult indicating whether file was uploaded or skipped
 */
export async function uploadFile(
  filePath: string,
  config: CloudDriveConfig,
  remotePath?: string
): Promise<UploadResult> {
  // 1. Get basic file information
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  const fileStat = fs.statSync(filePath);
  const fileSize = fileStat.size;
  const lastModified = fileStat.mtime.getTime().toString(); // Get millisecond timestamp
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  const fileStream = fs.createReadStream(filePath);
  const fileName = path.basename(filePath);

  // 2. Prepare request URL and path
  // URL is always a fixed PUT endpoint
  const url = config.apiUrl; // Assume apiUrl is http://127.0.0.1:5244/api/fs/put

  // Destination path logic
  const normalizedUploadPath = normalizeUploadPath(config.uploadPath);
  let destinationPath = "";

  if (remotePath) {
    // Check if remotePath is an absolute path (starts with /)
    // If it's an absolute path, use it directly; otherwise, append to uploadPath
    const normalizedRemotePath = remotePath.replace(/\\/g, "/");
    if (normalizedRemotePath.startsWith("/")) {
      // Absolute path - use it directly (e.g., /a/movies/video/thumbnail.jpg)
      destinationPath = normalizedRemotePath;
    } else {
      // Relative path - append to uploadPath (e.g., "subdir/file.jpg" -> "/mytube-uploads/subdir/file.jpg")
      destinationPath = normalizedUploadPath.endsWith("/")
        ? `${normalizedUploadPath}${normalizedRemotePath}`
        : `${normalizedUploadPath}/${normalizedRemotePath}`;
    }
  } else {
    // Default behavior: upload to root of uploadPath using source filename
    destinationPath = normalizedUploadPath.endsWith("/")
      ? `${normalizedUploadPath}${fileName}`
      : `${normalizedUploadPath}/${fileName}`;
  }

  // Ensure it starts with /
  destinationPath = destinationPath.startsWith("/")
    ? destinationPath
    : `/${destinationPath}`;

  // Check if file already exists in cloud storage before uploading
  const exists = await fileExistsInCloud(
    fileName,
    fileSize,
    destinationPath,
    config
  );

  if (exists) {
    return {
      uploaded: false,
      skipped: true,
      reason: "File already exists in cloud storage with same size",
    };
  }

  logger.info(
    `[CloudStorage] Uploading ${fileName} to ${destinationPath} (${fileSize} bytes)...`
  );

  logger.debug(`[CloudStorage] Destination path in header: ${destinationPath}`);

  // 3. Prepare Headers
  const headers = {
    // Key fix #1: Destination path is passed in Header
    "file-path": encodeURI(destinationPath), // Alist expects this header, needs encoding

    // Key fix #2: Authorization Header does not have 'Bearer ' prefix
    Authorization: config.token,

    // Key fix #3: Include Last-Modified Header
    "Last-Modified": lastModified,

    // Other Headers
    "Content-Type": "application/octet-stream", // Use generic stream type
    "Content-Length": fileSize.toString(),
  };

  try {
    // 4. Send PUT request, note that URL is fixed
    const response = await axios.put(url, fileStream, {
      headers: headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    // 5. Check if the returned JSON Body indicates real success
    if (response.data && response.data.code === 200) {
      logger.info(
        `[CloudStorage] Successfully uploaded ${fileName}. Server message: ${response.data.message}`
      );
      return {
        uploaded: true,
        skipped: false,
      };
    } else {
      // Even if HTTP status code is 200, server may return business errors
      const errorMessage = response.data
        ? response.data.message
        : "Unknown server error after upload";
      throw NetworkError.withStatus(
        `Upload failed on server: ${errorMessage} (Code: ${response.data?.code})`,
        response.status || 500
      );
    }
  } catch (error: any) {
    // Error handling logic
    if (error.response) {
      // HTTP error response
      const statusCode = error.response.status;
      logger.error(
        `[CloudStorage] HTTP Error: ${statusCode}`,
        new Error(JSON.stringify(error.response.data))
      );
      throw NetworkError.withStatus(
        `Upload failed: ${error.message}`,
        statusCode
      );
    } else if (error.request) {
      // Request was made but no response received
      logger.error("[CloudStorage] Network Error: No response received.");
      throw NetworkError.timeout();
    } else if (error.code === "ENOENT") {
      // File not found
      throw FileError.notFound(filePath);
    } else {
      // Other errors
      logger.error(
        "[CloudStorage] Upload Error:",
        error instanceof Error ? error : new Error(error.message)
      );
      throw FileError.writeError(filePath, error.message);
    }
  }
}
