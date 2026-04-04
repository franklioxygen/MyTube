import type { Request } from "express";
import crypto from "crypto";
import fs from "fs-extra";
import multer from "multer";
import path from "path";
import { ValidationError } from "../errors/DownloadErrors";
import {
  createWriteStreamSafe,
  ensureDirSafeSync,
  pathExistsSafeSync,
  resolveSafeChildPath,
  unlinkSafeSync,
} from "./security";

const HEADER_SNIFF_BYTES = 4096;

export const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mkv",
  ".avi",
  ".mov",
  ".m4v",
  ".flv",
  ".3gp",
]);

type VideoContainerKind = "iso-bmff" | "webm" | "matroska" | "avi" | "flv";

type VideoDetectionResult =
  | { state: "pending" }
  | { state: "invalid"; reason: string }
  | { state: "valid"; container: VideoContainerKind };

export interface UploadedVideoMetadata {
  contentHash?: string;
  detectedContainer?: VideoContainerKind;
  validationError?: string;
}

export type UploadedVideoFile = Express.Multer.File & UploadedVideoMetadata;

interface UploadStorageOptions {
  maxTotalBytes?: number;
}

interface UploadRequestState {
  totalBytes: number;
}

const INVALID_UPLOAD_MESSAGE =
  "Uploaded file is empty or has an unsupported video signature.";

const hasEbmlHeader = (buffer: Buffer): boolean =>
  buffer.length >= 4 &&
  buffer[0] === 0x1a &&
  buffer[1] === 0x45 &&
  buffer[2] === 0xdf &&
  buffer[3] === 0xa3;

const isRiffAvi = (buffer: Buffer): boolean =>
  buffer.length >= 12 &&
  buffer.toString("ascii", 0, 4) === "RIFF" &&
  buffer.toString("ascii", 8, 12) === "AVI ";

const isFlv = (buffer: Buffer): boolean =>
  buffer.length >= 3 && buffer.toString("ascii", 0, 3) === "FLV";

const getIsoBmffBrands = (buffer: Buffer): string[] => {
  if (buffer.length < 16 || buffer.toString("ascii", 4, 8) !== "ftyp") {
    return [];
  }

  const brands = [buffer.toString("ascii", 8, 12)];
  const boxSize = buffer.readUInt32BE(0);
  const upperBound = Math.min(
    buffer.length,
    Number.isInteger(boxSize) && boxSize >= 16 ? boxSize : buffer.length
  );

  for (let offset = 16; offset + 4 <= upperBound; offset += 4) {
    brands.push(buffer.toString("ascii", offset, offset + 4));
  }

  return brands;
};

const isExtensionCompatible = (
  extension: string,
  container: VideoContainerKind,
  buffer: Buffer
): boolean => {
  if (container === "avi") {
    return extension === ".avi";
  }

  if (container === "flv") {
    return extension === ".flv";
  }

  if (container === "webm") {
    return extension === ".webm";
  }

  if (container === "matroska") {
    return extension === ".mkv";
  }

  const brands = getIsoBmffBrands(buffer);
  if (brands.length === 0) {
    return false;
  }

  if (extension === ".mov") {
    return brands.includes("qt  ");
  }

  if (extension === ".3gp") {
    return brands.some((brand) => brand.toLowerCase().startsWith("3g"));
  }

  if (extension === ".m4v") {
    return brands.some((brand) => brand.trim().toUpperCase().startsWith("M4V"));
  }

  return extension === ".mp4";
};

export const isSupportedVideoExtension = (filename: string): boolean =>
  SUPPORTED_VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());

export const detectVideoContainer = (
  buffer: Buffer,
  originalFilename: string,
  isFinalChunk: boolean = false
): VideoDetectionResult => {
  const extension = path.extname(originalFilename).toLowerCase();

  if (!SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
    return {
      state: "invalid",
      reason: "Invalid file type. Only supported video files are allowed.",
    };
  }

  if (buffer.length === 0) {
    return isFinalChunk
      ? { state: "invalid", reason: INVALID_UPLOAD_MESSAGE }
      : { state: "pending" };
  }

  if (isFlv(buffer)) {
    return isExtensionCompatible(extension, "flv", buffer)
      ? { state: "valid", container: "flv" }
      : { state: "invalid", reason: INVALID_UPLOAD_MESSAGE };
  }

  if (isRiffAvi(buffer)) {
    return isExtensionCompatible(extension, "avi", buffer)
      ? { state: "valid", container: "avi" }
      : { state: "invalid", reason: INVALID_UPLOAD_MESSAGE };
  }

  if (hasEbmlHeader(buffer)) {
    const normalizedHeader = buffer.toString("ascii").toLowerCase();
    if (normalizedHeader.includes("webm")) {
      return isExtensionCompatible(extension, "webm", buffer)
        ? { state: "valid", container: "webm" }
        : { state: "invalid", reason: INVALID_UPLOAD_MESSAGE };
    }
    if (normalizedHeader.includes("matroska")) {
      return isExtensionCompatible(extension, "matroska", buffer)
        ? { state: "valid", container: "matroska" }
        : { state: "invalid", reason: INVALID_UPLOAD_MESSAGE };
    }

    if (!isFinalChunk && buffer.length < HEADER_SNIFF_BYTES) {
      return { state: "pending" };
    }

    return { state: "invalid", reason: INVALID_UPLOAD_MESSAGE };
  }

  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return isExtensionCompatible(extension, "iso-bmff", buffer)
      ? { state: "valid", container: "iso-bmff" }
      : { state: "invalid", reason: INVALID_UPLOAD_MESSAGE };
  }

  if (!isFinalChunk && buffer.length < 12) {
    return { state: "pending" };
  }

  return { state: "invalid", reason: INVALID_UPLOAD_MESSAGE };
};

const finalizeUploadHash = (hash: crypto.Hash): string => hash.digest("hex");

export const createVideoUploadStorage = (
  destinationDir: string,
  options: UploadStorageOptions = {}
): multer.StorageEngine => {
  const requestStates = new WeakMap<Request, UploadRequestState>();

  return {
    _handleFile(req, file, cb) {
      const requestState = requestStates.get(req) ?? { totalBytes: 0 };
      requestStates.set(req, requestState);

      const originalExtension = path.extname(file.originalname).toLowerCase();
      const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${originalExtension || ".upload"}`;
      const targetPath = resolveSafeChildPath(destinationDir, filename);
      const hash = crypto.createHash("sha256");
      const bufferedChunks: Buffer[] = [];
      let bufferedBytes = 0;
      let totalSize = 0;
      let detection = detectVideoContainer(Buffer.alloc(0), file.originalname);
      const initialValidationReason =
        detection.state === "invalid" ? detection.reason : null;
      let writeStream: fs.WriteStream | null = null;
      let settled = false;
      let digest: string | null = null;
      let draining = false;

      const formatMaxTotalBytes = (bytes: number): string => {
        const gibibytes = bytes / (1024 * 1024 * 1024);
        return Number.isInteger(gibibytes)
          ? `${gibibytes} GB`
          : `${gibibytes.toFixed(1)} GB`;
      };

      const finishHash = (): string => {
        if (digest === null) {
          digest = finalizeUploadHash(hash);
        }
        return digest;
      };

      const cleanup = () => {
        if (writeStream) {
          writeStream.destroy();
        }
        if (pathExistsSafeSync(targetPath, destinationDir)) {
          unlinkSafeSync(targetPath, destinationDir);
        }
      };

      const complete = (
        error: Error | null,
        info?: Partial<UploadedVideoFile>
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        cb(error, info);
      };

      const abortUpload = (message: string) => {
        cleanup();
        complete(createUploadValidationError(message));
      };

      const ensureWriteStream = () => {
        if (writeStream) {
          return writeStream;
        }

        ensureDirSafeSync(destinationDir, destinationDir);
        writeStream = createWriteStreamSafe(targetPath, destinationDir);
        writeStream.on("error", (error) => {
          cleanup();
          if (!settled) {
            complete(error as Error);
          }
        });
        return writeStream;
      };

      const writeChunk = (chunk: Buffer) => {
        const stream = ensureWriteStream();
        if (!stream.write(chunk) && !draining) {
          draining = true;
          file.stream.pause();
          stream.once("drain", () => {
            draining = false;
            file.stream.resume();
          });
        }
      };

      file.stream.on("data", (chunk: Buffer | string) => {
        if (settled) {
          return;
        }

        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const nextRequestTotal = requestState.totalBytes + buffer.length;
        if (
          typeof options.maxTotalBytes === "number" &&
          nextRequestTotal > options.maxTotalBytes
        ) {
          abortUpload(
            `Batch upload too large. Maximum total size is ${formatMaxTotalBytes(
              options.maxTotalBytes
            )} per request.`
          );
          return;
        }

        requestState.totalBytes = nextRequestTotal;
        totalSize += buffer.length;
        hash.update(buffer);

        if (detection.state === "invalid") {
          abortUpload(detection.reason);
          return;
        }

        if (detection.state === "pending") {
          bufferedChunks.push(buffer);
          bufferedBytes += buffer.length;
          detection = detectVideoContainer(
            Buffer.concat(bufferedChunks),
            file.originalname,
            bufferedBytes >= HEADER_SNIFF_BYTES
          );

          if (detection.state === "invalid") {
            abortUpload(detection.reason);
            return;
          }

          if (detection.state !== "valid") {
            return;
          }

          for (const bufferedChunk of bufferedChunks) {
            writeChunk(bufferedChunk);
          }
          bufferedChunks.length = 0;
          bufferedBytes = 0;
          return;
        }

        writeChunk(buffer);
      });

      file.stream.on("error", (error) => {
        cleanup();
        if (!settled) {
          complete(error as Error);
        }
      });

      file.stream.on("end", () => {
        if (settled) {
          return;
        }

        if (detection.state === "pending") {
          detection = detectVideoContainer(
            Buffer.concat(bufferedChunks),
            file.originalname,
            true
          );

          if (detection.state === "valid") {
            for (const bufferedChunk of bufferedChunks) {
              writeChunk(bufferedChunk);
            }
          }
        }

        if (detection.state !== "valid") {
          complete(null, {
            size: totalSize,
            validationError:
              detection.state === "invalid"
                ? detection.reason
                : INVALID_UPLOAD_MESSAGE,
          });
          return;
        }

        const stream = ensureWriteStream();
        const detectedContainer = detection.container;
        stream.end(() => {
          complete(null, {
            destination: destinationDir,
            filename,
            path: targetPath,
            size: totalSize,
            contentHash: finishHash(),
            detectedContainer,
          });
        });
      });

      if (initialValidationReason) {
        process.nextTick(() => {
          if (!settled) {
            abortUpload(initialValidationReason);
          }
        });
      }
    },

    _removeFile(_req, file, cb) {
      try {
        const storedFile = file as UploadedVideoFile;
        if (storedFile.path && pathExistsSafeSync(storedFile.path, destinationDir)) {
          unlinkSafeSync(storedFile.path, destinationDir);
        }
        cb(null);
      } catch (error) {
        cb(error as Error);
      }
    },
  };
};

export const getUploadVideoId = (contentHash: string): string =>
  `upload-${contentHash}`;

export const createUploadValidationError = (message: string): ValidationError =>
  new ValidationError(message, "file");
