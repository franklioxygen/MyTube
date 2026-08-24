import path from "path";
import { getProviderPluginPath } from "../../../services/downloaders/ytdlp/ytdlpHelpers";

export function captureProcessEnv(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return { ...source };
}

export function buildManagedSpawnEnv(
  sitePackagesPath: string,
  capturedEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const bundled = getProviderPluginPath();
  const pythonPath = [bundled, sitePackagesPath].filter(Boolean).join(path.delimiter);
  return {
    ...capturedEnv,
    PYTHONPATH: pythonPath,
    PYTHONNOUSERSITE: "1",
  };
}

export function buildExternalSpawnEnv(
  capturedEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const bundled = getProviderPluginPath();
  if (!bundled) {
    return { ...capturedEnv };
  }
  const entries = (capturedEnv.PYTHONPATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  if (!entries.includes(bundled)) {
    entries.unshift(bundled);
  }
  return {
    ...capturedEnv,
    PYTHONPATH: entries.join(path.delimiter),
  };
}
