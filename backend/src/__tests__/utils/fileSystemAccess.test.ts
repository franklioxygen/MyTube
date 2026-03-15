import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  pathEntryExistsSync,
  removeFileSync,
  renamePathSync,
  writeUtf8FileSync,
} from "../../utils/fileSystemAccess";

describe("fileSystemAccess", () => {
  const tempRoots: string[] = [];

  const getManagedTempPath = (
    targetPath: string,
  ): { safePath: string; safePathPrefix: string } => {
    const safePath = path.resolve(targetPath);
    const managedRoot = tempRoots.find(
      (tempRoot) =>
        safePath === tempRoot || safePath.startsWith(`${tempRoot}${path.sep}`),
    );

    if (!managedRoot) {
      throw new Error(`Unmanaged temp path: ${targetPath}`);
    }

    return {
      safePath,
      safePathPrefix:
        safePath === managedRoot || managedRoot.endsWith(path.sep)
          ? managedRoot
          : `${managedRoot}${path.sep}`,
    };
  };

  const tempPathExists = (targetPath: string): boolean => {
    const { safePath, safePathPrefix } = getManagedTempPath(targetPath);
    if (!safePath.startsWith(safePathPrefix)) {
      throw new Error(`Temp path escaped test root: ${targetPath}`);
    }
    return fs.existsSync(safePath);
  };

  const writeTempFileSync = (targetPath: string, content: string): void => {
    const { safePath, safePathPrefix } = getManagedTempPath(targetPath);
    if (!safePath.startsWith(safePathPrefix)) {
      throw new Error(`Temp path escaped test root: ${targetPath}`);
    }
    fs.writeFileSync(safePath, content);
  };

  const createTempSymlinkSync = (
    targetPath: string,
    symlinkPath: string,
    type?: "dir" | "file" | "junction",
  ): void => {
    const { safePath: safeTargetPath, safePathPrefix: safeTargetPrefix } =
      getManagedTempPath(targetPath);
    if (!safeTargetPath.startsWith(safeTargetPrefix)) {
      throw new Error(`Symlink target escaped test root: ${targetPath}`);
    }

    const { safePath: safeSymlinkPath, safePathPrefix: safeSymlinkPrefix } =
      getManagedTempPath(symlinkPath);
    if (!safeSymlinkPath.startsWith(safeSymlinkPrefix)) {
      throw new Error(`Symlink path escaped test root: ${symlinkPath}`);
    }

    fs.symlinkSync(safeTargetPath, safeSymlinkPath, type);
  };

  const lstatTempPath = (targetPath: string): fs.Stats => {
    const { safePath, safePathPrefix } = getManagedTempPath(targetPath);
    if (!safePath.startsWith(safePathPrefix)) {
      throw new Error(`Temp path escaped test root: ${targetPath}`);
    }
    return fs.lstatSync(safePath);
  };

  const readTempSymlink = (targetPath: string): string => {
    const { safePath, safePathPrefix } = getManagedTempPath(targetPath);
    if (!safePath.startsWith(safePathPrefix)) {
      throw new Error(`Temp path escaped test root: ${targetPath}`);
    }
    return fs.readlinkSync(safePath);
  };

  afterEach(() => {
    tempRoots.splice(0).forEach((tempRoot) => {
      fs.removeSync(tempRoot);
    });
  });

  it("rejects writes through dangling symlink ancestors that escape the allow-list", () => {
    if (process.platform === "win32") {
      return;
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-fsa-"));
    tempRoots.push(tempRoot);

    const allowedDir = path.join(tempRoot, "allowed");
    const outsideDir = path.join(tempRoot, "outside");
    const symlinkDir = path.join(allowedDir, "escape");
    const escapedTargetPath = path.join(outsideDir, "missing", "created.txt");

    fs.ensureDirSync(allowedDir);
    fs.ensureDirSync(outsideDir);
    createTempSymlinkSync(path.join(outsideDir, "missing"), symlinkDir, "dir");

    expect(() =>
      writeUtf8FileSync(path.join(symlinkDir, "created.txt"), "hello", [allowedDir])
    ).toThrow("outside allowed directories");
    expect(tempPathExists(escapedTargetPath)).toBe(false);
  });

  it("removes the symlink entry without deleting its target", () => {
    if (process.platform === "win32") {
      return;
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-fsa-"));
    tempRoots.push(tempRoot);

    const allowedDir = path.join(tempRoot, "allowed");
    const targetPath = path.join(allowedDir, "target.txt");
    const symlinkPath = path.join(allowedDir, "link.txt");

    fs.ensureDirSync(allowedDir);
    writeTempFileSync(targetPath, "hello");
    createTempSymlinkSync(targetPath, symlinkPath);

    removeFileSync(symlinkPath, [allowedDir]);

    expect(tempPathExists(targetPath)).toBe(true);
    expect(() => lstatTempPath(symlinkPath)).toThrow(/ENOENT/);
  });

  it("treats escaped symlink leaf entries as removable local entries", () => {
    if (process.platform === "win32") {
      return;
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-fsa-"));
    tempRoots.push(tempRoot);

    const allowedDir = path.join(tempRoot, "allowed");
    const outsideDir = path.join(tempRoot, "outside");
    const targetPath = path.join(outsideDir, "target.txt");
    const symlinkPath = path.join(allowedDir, "link.txt");

    fs.ensureDirSync(allowedDir);
    fs.ensureDirSync(outsideDir);
    writeTempFileSync(targetPath, "hello");
    createTempSymlinkSync(targetPath, symlinkPath);

    expect(pathEntryExistsSync(symlinkPath, [allowedDir])).toBe(true);

    removeFileSync(symlinkPath, [allowedDir]);

    expect(tempPathExists(targetPath)).toBe(true);
    expect(() => lstatTempPath(symlinkPath)).toThrow(/ENOENT/);
  });

  it("renames symlink entries without traversing to escaped targets", () => {
    if (process.platform === "win32") {
      return;
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-fsa-"));
    tempRoots.push(tempRoot);

    const allowedDir = path.join(tempRoot, "allowed");
    const outsideDir = path.join(tempRoot, "outside");
    const targetPath = path.join(outsideDir, "target.txt");
    const sourcePath = path.join(allowedDir, "link.txt");
    const destinationPath = path.join(allowedDir, "renamed-link.txt");

    fs.ensureDirSync(allowedDir);
    fs.ensureDirSync(outsideDir);
    writeTempFileSync(targetPath, "hello");
    createTempSymlinkSync(targetPath, sourcePath);

    renamePathSync(sourcePath, destinationPath, [allowedDir]);

    expect(tempPathExists(targetPath)).toBe(true);
    expect(() => lstatTempPath(sourcePath)).toThrow(/ENOENT/);
    expect(lstatTempPath(destinationPath).isSymbolicLink()).toBe(true);
    expect(readTempSymlink(destinationPath)).toBe(targetPath);
  });
});
