import path from "path";
import { DEFAULT_YT_DLP_PATH } from "./constants";
import {
  pathExistsSafeSync,
  pathExistsTrustedSync,
  readdirSafeSync,
  resolveSafeChildPath,
} from "../security";
import {
  YtDlpCandidateProbe,
  isBetterYtDlpCandidate,
  probeYtDlpCandidate,
} from "./versionProbe";

let resolvedYtDlpPathCache: string | null = null;

function appendUniquePathEntry(entries: string[], candidate: string): void {
  if (!candidate || entries.includes(candidate)) {
    return;
  }

  entries.push(candidate);
}

function prependUniquePathEntry(entries: string[], candidate: string): void {
  if (!candidate) {
    return;
  }

  const existingIndex = entries.indexOf(candidate);
  if (existingIndex === 0) {
    return;
  }

  if (existingIndex > 0) {
    entries.splice(existingIndex, 1);
  }

  entries.unshift(candidate);
}

function appendSafeChildDir(
  entries: string[],
  allowedDir: string,
  childDir: string
): void {
  try {
    appendUniquePathEntry(entries, resolveSafeChildPath(allowedDir, childDir));
  } catch {
    // Ignore invalid child paths discovered while scanning local install roots.
  }
}

function getYtDlpExecutableNames(): string[] {
  return process.platform === "win32"
    ? ["yt-dlp.exe", "yt-dlp.cmd", "yt-dlp.bat", "yt-dlp"]
    : ["yt-dlp"];
}

function appendWindowsPythonScriptsDirs(
  candidateDirs: string[],
  rootDir: string
): void {
  try {
    for (const entry of readdirSafeSync(rootDir, rootDir)) {
      if (!/^python\d+(?:-\d+)?$/i.test(entry)) {
        continue;
      }
      const pythonDir = resolveSafeChildPath(rootDir, entry);
      appendSafeChildDir(candidateDirs, pythonDir, "Scripts");
    }
  } catch {
    // Ignore missing or unreadable Python installation roots.
  }
}

function listLikelyUserBinDirs(): string[] {
  const candidateDirs: string[] = [];

  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE?.trim();
    const appData =
      process.env.APPDATA?.trim() ||
      (userProfile ? path.join(userProfile, "AppData", "Roaming") : "");
    const localAppData =
      process.env.LOCALAPPDATA?.trim() ||
      (userProfile ? path.join(userProfile, "AppData", "Local") : "");

    if (appData) {
      appendUniquePathEntry(candidateDirs, path.join(appData, "Python", "Scripts"));
      appendWindowsPythonScriptsDirs(candidateDirs, path.join(appData, "Python"));
    }

    if (localAppData) {
      appendWindowsPythonScriptsDirs(
        candidateDirs,
        path.join(localAppData, "Programs", "Python")
      );
    }

    return candidateDirs;
  }

  const homeDir = process.env.HOME?.trim();
  if (!homeDir) {
    return candidateDirs;
  }

  appendUniquePathEntry(candidateDirs, path.join(homeDir, ".local", "bin"));

  if (process.platform === "darwin") {
    const macUserPythonRoot = path.join(homeDir, "Library", "Python");
    try {
      for (const entry of readdirSafeSync(macUserPythonRoot, macUserPythonRoot)) {
        if (!/^\d+\.\d+$/.test(entry)) {
          continue;
        }
        const pythonDir = resolveSafeChildPath(macUserPythonRoot, entry);
        appendSafeChildDir(candidateDirs, pythonDir, "bin");
      }
    } catch {
      // Ignore missing or unreadable user Python directories.
    }
  }

  return candidateDirs;
}

function getExplicitConfiguredYtDlpPath(): string | null {
  const configuredPath = process.env.YT_DLP_PATH?.trim();
  return configuredPath ? configuredPath : null;
}

export function getConfiguredYtDlpPath(): string {
  return (
    getExplicitConfiguredYtDlpPath() ||
    resolvedYtDlpPathCache ||
    DEFAULT_YT_DLP_PATH
  );
}

export function hasCustomConfiguredYtDlpPath(): boolean {
  return Boolean(
    getExplicitConfiguredYtDlpPath() &&
      getExplicitConfiguredYtDlpPath() !== DEFAULT_YT_DLP_PATH
  );
}

function listYtDlpPathCandidates(): string[] {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const candidateDir of listLikelyUserBinDirs()) {
    appendUniquePathEntry(pathEntries, candidateDir);
  }
  const executableNames = getYtDlpExecutableNames();

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const entry of pathEntries) {
    for (const executableName of executableNames) {
      let candidatePath: string;
      try {
        candidatePath = resolveSafeChildPath(entry, executableName);
      } catch {
        continue;
      }
      let candidateExists = false;
      try {
        candidateExists = pathExistsSafeSync(candidatePath, entry);
      } catch {
        continue;
      }
      if (!candidateExists || seen.has(candidatePath)) {
        continue;
      }
      seen.add(candidatePath);
      candidates.push(candidatePath);
    }
  }

  return candidates;
}

export function updatePathAfterAutoInstall(): void {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);

  for (const candidateDir of listLikelyUserBinDirs()) {
    const hasExecutable = getYtDlpExecutableNames().some((executableName) => {
      try {
        const candidatePath = `${candidateDir}${path.sep}${executableName}`;
        return pathExistsTrustedSync(candidatePath);
      } catch {
        return false;
      }
    });

    if (hasExecutable) {
      prependUniquePathEntry(pathEntries, candidateDir);
    }
  }

  process.env.PATH = pathEntries.join(path.delimiter);
}

export async function resolveYtDlpPath(): Promise<string> {
  const explicitPath = getExplicitConfiguredYtDlpPath();
  if (explicitPath) {
    return explicitPath;
  }

  if (resolvedYtDlpPathCache) {
    return resolvedYtDlpPathCache;
  }

  const candidates = listYtDlpPathCandidates();
  if (candidates.length === 0) {
    resolvedYtDlpPathCache = DEFAULT_YT_DLP_PATH;
    return resolvedYtDlpPathCache;
  }

  let bestCandidate: string | null = null;
  let bestProbe: YtDlpCandidateProbe | null = null;
  for (const candidate of candidates) {
    const probe = await probeYtDlpCandidate(candidate);
    if (!probe.canRun) {
      continue;
    }

    if (isBetterYtDlpCandidate(probe, bestProbe)) {
      bestCandidate = candidate;
      bestProbe = probe;
    }
  }

  resolvedYtDlpPathCache = bestCandidate || DEFAULT_YT_DLP_PATH;
  return resolvedYtDlpPathCache;
}

export function resetResolvedYtDlpPath(): void {
  resolvedYtDlpPathCache = null;
}
