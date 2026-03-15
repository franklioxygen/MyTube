import path from "path";
import { DATA_DIR } from "../../config/paths";

const FROZEN_LISTS_DIR = path.join(DATA_DIR, "frozen-lists");
const SAFE_FROZEN_LIST_TASK_ID = /^[A-Za-z0-9_-]+$/;

export const getFrozenListsRoot = (): string => path.resolve(FROZEN_LISTS_DIR);

export const buildFrozenListPath = (taskId: string): string => {
  const normalizedTaskId = String(taskId).trim();
  if (!SAFE_FROZEN_LIST_TASK_ID.test(normalizedTaskId)) {
    throw new Error(`Invalid task id for frozen list path: ${taskId}`);
  }

  const frozenPath = path.join(getFrozenListsRoot(), `${normalizedTaskId}.json`);
  const resolvedFrozenPath = path.resolve(frozenPath);
  const root = getFrozenListsRoot();
  if (!resolvedFrozenPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Frozen list path escaped root directory for task ${taskId}`);
  }

  return resolvedFrozenPath;
};

export const resolveStoredFrozenListPath = (rawPath: string): string => {
  const resolvedPath = path.resolve(rawPath);
  const root = getFrozenListsRoot();
  if (!resolvedPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Frozen list path outside allowed directory: ${rawPath}`);
  }

  const fileName = path.basename(resolvedPath);
  if (!fileName.endsWith(".json")) {
    throw new Error(`Frozen list file must be a .json file: ${rawPath}`);
  }

  const taskIdFromFileName = fileName.slice(0, -".json".length);
  if (!SAFE_FROZEN_LIST_TASK_ID.test(taskIdFromFileName)) {
    throw new Error(`Frozen list file name is invalid: ${rawPath}`);
  }

  return resolvedPath;
};
