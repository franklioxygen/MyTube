"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const SUPPORTED_FILE_TYPES = [
  { ext: "jpg", mime: "image/jpeg" },
  { ext: "png", mime: "image/png" },
  { ext: "gif", mime: "image/gif" },
  { ext: "webp", mime: "image/webp" },
  { ext: "avif", mime: "image/avif" },
  { ext: "tif", mime: "image/tiff" },
  { ext: "bmp", mime: "image/bmp" },
];

const supportedExtensions = new Set(SUPPORTED_FILE_TYPES.map((entry) => entry.ext));
const supportedMimeTypes = new Set(SUPPORTED_FILE_TYPES.map((entry) => entry.mime));
const ALLOWED_FILE_ROOTS = [process.cwd(), os.tmpdir()].map((rootPath) =>
  path.resolve(rootPath)
);

const isPathWithinAllowedRoot = (targetPath, allowedRoot) => {
  const relativePath = path.relative(allowedRoot, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
};

const ensurePathWithinAllowedRoots = (targetPath, allowedRoots) => {
  const isAllowed = allowedRoots.some((allowedRoot) =>
    isPathWithinAllowedRoot(targetPath, allowedRoot)
  );

  if (!isAllowed) {
    throw new Error(`Refusing to read file outside allowed roots: ${targetPath}`);
  }
};

const validateFilePath = async (filePath) => {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new TypeError("Expected filePath to be a non-empty string");
  }

  const resolvedPath = path.resolve(filePath);
  ensurePathWithinAllowedRoots(resolvedPath, ALLOWED_FILE_ROOTS);
  const realPath = await fs.promises.realpath(resolvedPath);
  const resolvedAllowedRoots = await Promise.all(
    ALLOWED_FILE_ROOTS.map(async (allowedRoot) => {
      try {
        return await fs.promises.realpath(allowedRoot);
      } catch {
        return allowedRoot;
      }
    })
  );
  ensurePathWithinAllowedRoots(realPath, resolvedAllowedRoots);
  return realPath;
};

const hasBytes = (buffer, offset, signature) => {
  if (buffer.length < offset + signature.length) {
    return false;
  }

  for (let index = 0; index < signature.length; index += 1) {
    if (buffer[offset + index] !== signature[index]) {
      return false;
    }
  }

  return true;
};

const normalizeBuffer = (input) => {
  if (Buffer.isBuffer(input)) {
    return input;
  }

  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }

  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }

  throw new TypeError("Expected a Buffer, Uint8Array or ArrayBuffer");
};

const getIsoBmffBrands = (buffer) => {
  if (buffer.length < 16 || buffer.toString("ascii", 4, 8) !== "ftyp") {
    return [];
  }

  const brands = [];
  const majorBrand = buffer.toString("ascii", 8, 12);
  brands.push(majorBrand);

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

const detectFileType = (input) => {
  const buffer = normalizeBuffer(input);
  if (buffer.length === 0) {
    return undefined;
  }

  if (hasBytes(buffer, 0, [0xff, 0xd8, 0xff])) {
    return { ext: "jpg", mime: "image/jpeg" };
  }

  if (hasBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: "png", mime: "image/png" };
  }

  if (
    hasBytes(buffer, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    hasBytes(buffer, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return { ext: "gif", mime: "image/gif" };
  }

  if (
    hasBytes(buffer, 0, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(buffer, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return { ext: "webp", mime: "image/webp" };
  }

  const brands = getIsoBmffBrands(buffer);
  if (brands.includes("avif") || brands.includes("avis")) {
    return { ext: "avif", mime: "image/avif" };
  }

  if (
    hasBytes(buffer, 0, [0x49, 0x49, 0x2a, 0x00]) ||
    hasBytes(buffer, 0, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return { ext: "tif", mime: "image/tiff" };
  }

  if (hasBytes(buffer, 0, [0x42, 0x4d])) {
    return { ext: "bmp", mime: "image/bmp" };
  }

  return undefined;
};

const fromBuffer = async (input) => detectFileType(input);

const fromFile = async (filePath) => {
  const safeFilePath = await validateFilePath(filePath);
  const fileHandle = await fs.promises.open(safeFilePath, "r");

  try {
    const sample = Buffer.alloc(4100);
    const { bytesRead } = await fileHandle.read(sample, 0, sample.length, 0);
    return detectFileType(sample.subarray(0, bytesRead));
  } finally {
    await fileHandle.close();
  }
};

const api = {
  fromBuffer,
  fromFile,
  fileTypeFromBuffer: fromBuffer,
  fileTypeFromFile: fromFile,
  supportedExtensions,
  supportedMimeTypes,
};

module.exports = api;
module.exports.default = api;
