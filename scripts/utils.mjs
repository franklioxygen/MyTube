import path from "node:path";
import process from "node:process";

export function resolvePathWithinCwd(targetPath) {
  if (!targetPath || typeof targetPath !== "string") {
    throw new Error(`Invalid path: ${targetPath}`);
  }

  const workspaceRoot = process.cwd();
  const absolutePath = path.resolve(workspaceRoot, targetPath);
  const relativePath = path.relative(workspaceRoot, absolutePath);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Path must stay within ${workspaceRoot}: ${targetPath}`);
  }

  return absolutePath;
}
