import path from "path";
import { isPathWithinDirectory } from "../utils/security";

export const PLATFORM_MOUNT_DIRECTORIES_ENV_KEY = "PLATFORM_MOUNT_DIRECTORIES";

const DIRECTORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface PlatformMountDirectory {
  id: string;
  label: string;
  path: string;
}

export interface PlatformMountDirectoryDescriptor {
  id: string;
  label: string;
}

interface ResolvePlatformMountDirectoriesOptions {
  rawConfig?: string | undefined;
}

interface RawPlatformMountDirectory {
  id?: unknown;
  label?: unknown;
  path?: unknown;
}

const normalizeMountPath = (rawPath: string): string | null => {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0 || trimmed.includes("\0")) {
    return null;
  }

  const normalized = path.resolve(path.normalize(trimmed));
  if (!path.isAbsolute(normalized)) {
    return null;
  }

  return normalized;
};

const isValidDirectoryId = (id: string): boolean =>
  DIRECTORY_ID_PATTERN.test(id);

export const resolvePlatformMountDirectories = (
  options: ResolvePlatformMountDirectoriesOptions = {}
): PlatformMountDirectory[] => {
  const rawConfig =
    options.rawConfig ?? process.env[PLATFORM_MOUNT_DIRECTORIES_ENV_KEY];

  if (typeof rawConfig !== "string" || rawConfig.trim().length === 0) {
    return [];
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch {
    return [];
  }

  if (!Array.isArray(parsedConfig)) {
    return [];
  }

  const accepted: PlatformMountDirectory[] = [];
  const usedIds = new Set<string>();

  for (const entry of parsedConfig as RawPlatformMountDirectory[]) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const rawId = typeof entry.id === "string" ? entry.id.trim() : "";
    const rawPath = typeof entry.path === "string" ? entry.path : "";
    const rawLabel = typeof entry.label === "string" ? entry.label.trim() : "";

    if (!isValidDirectoryId(rawId) || usedIds.has(rawId)) {
      continue;
    }

    const normalizedPath = normalizeMountPath(rawPath);
    if (normalizedPath === null) {
      continue;
    }

    usedIds.add(rawId);
    accepted.push({
      id: rawId,
      label: rawLabel.length > 0 ? rawLabel : rawId,
      path: normalizedPath,
    });
  }

  return accepted;
};

const isPathWithinMountRoot = (filePath: string, mountRoot: string): boolean =>
  isPathWithinDirectory(filePath, mountRoot);

export const isPathWithinPlatformMountDirectories = (
  filePath: string,
  configuredDirectories = resolvePlatformMountDirectories()
): boolean => {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    return false;
  }

  const normalizedPath = normalizeMountPath(filePath);
  if (normalizedPath === null) {
    return false;
  }

  return configuredDirectories.some((directory) =>
    isPathWithinMountRoot(normalizedPath, directory.path)
  );
};

export const resolveMountDirectoriesByIds = (
  requestedDirectoryIds: string[],
  configuredDirectories = resolvePlatformMountDirectories()
): {
  matchedDirectories: PlatformMountDirectory[];
  invalidDirectoryIds: string[];
} => {
  const directoryById = new Map<string, PlatformMountDirectory>();
  for (const directory of configuredDirectories) {
    directoryById.set(directory.id, directory);
  }

  const matchedDirectories: PlatformMountDirectory[] = [];
  const invalidDirectoryIds: string[] = [];
  const visitedIds = new Set<string>();

  for (const rawId of requestedDirectoryIds) {
    const normalizedId = rawId.trim();
    if (!normalizedId || visitedIds.has(normalizedId)) {
      continue;
    }
    visitedIds.add(normalizedId);

    const matched = directoryById.get(normalizedId);
    if (!matched) {
      invalidDirectoryIds.push(normalizedId);
      continue;
    }

    matchedDirectories.push(matched);
  }

  return { matchedDirectories, invalidDirectoryIds };
};

export const getPlatformMountDirectoryDescriptors = (
  configuredDirectories = resolvePlatformMountDirectories()
): PlatformMountDirectoryDescriptor[] =>
  configuredDirectories.map((directory) => ({
    id: directory.id,
    label: directory.label,
  }));

export const getLegacyMountDirectoriesValue = (
  configuredDirectories = resolvePlatformMountDirectories()
): string =>
  configuredDirectories.map((directory) => directory.path).join("\n");
