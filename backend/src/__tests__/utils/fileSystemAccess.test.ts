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

  const getManagedTempPath = (targetPath: string): string => {
    const safePath = path.resolve(targetPath);
    const managedRoot = tempRoots.find(
      (tempRoot) =>
        safePath === tempRoot || safePath.startsWith(`${tempRoot}${path.sep}`),
    );

    if (!managedRoot) {
      throw new Error(`Unmanaged temp path: ${targetPath}`);
    }

    return safePath;
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
    fs.symlinkSync(
      getManagedTempPath(path.join(outsideDir, "missing")),
      getManagedTempPath(symlinkDir),
      "dir",
    );

    expect(() =>
      writeUtf8FileSync(path.join(symlinkDir, "created.txt"), "hello", [allowedDir])
    ).toThrow("outside allowed directories");
    expect(fs.existsSync(getManagedTempPath(escapedTargetPath))).toBe(false);
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
    fs.writeFileSync(getManagedTempPath(targetPath), "hello");
    fs.symlinkSync(getManagedTempPath(targetPath), getManagedTempPath(symlinkPath));

    removeFileSync(symlinkPath, [allowedDir]);

    expect(fs.existsSync(getManagedTempPath(targetPath))).toBe(true);
    expect(() => fs.lstatSync(getManagedTempPath(symlinkPath))).toThrow(/ENOENT/);
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
    fs.writeFileSync(getManagedTempPath(targetPath), "hello");
    fs.symlinkSync(getManagedTempPath(targetPath), getManagedTempPath(symlinkPath));

    expect(pathEntryExistsSync(symlinkPath, [allowedDir])).toBe(true);

    removeFileSync(symlinkPath, [allowedDir]);

    expect(fs.existsSync(getManagedTempPath(targetPath))).toBe(true);
    expect(() => fs.lstatSync(getManagedTempPath(symlinkPath))).toThrow(/ENOENT/);
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
    fs.writeFileSync(getManagedTempPath(targetPath), "hello");
    fs.symlinkSync(getManagedTempPath(targetPath), getManagedTempPath(sourcePath));

    renamePathSync(sourcePath, destinationPath, [allowedDir]);

    expect(fs.existsSync(getManagedTempPath(targetPath))).toBe(true);
    expect(() => fs.lstatSync(getManagedTempPath(sourcePath))).toThrow(/ENOENT/);
    expect(fs.lstatSync(getManagedTempPath(destinationPath)).isSymbolicLink()).toBe(
      true
    );
    expect(fs.readlinkSync(getManagedTempPath(destinationPath))).toBe(targetPath);
  });
});
