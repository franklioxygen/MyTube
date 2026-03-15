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
    fs.symlinkSync(path.join(outsideDir, "missing"), symlinkDir, "dir");

    expect(() =>
      writeUtf8FileSync(path.join(symlinkDir, "created.txt"), "hello", [allowedDir])
    ).toThrow("outside allowed directories");
    expect(fs.existsSync(escapedTargetPath)).toBe(false);
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
    fs.writeFileSync(targetPath, "hello");
    fs.symlinkSync(targetPath, symlinkPath);

    removeFileSync(symlinkPath, [allowedDir]);

    expect(fs.existsSync(targetPath)).toBe(true);
    expect(() => fs.lstatSync(symlinkPath)).toThrow(/ENOENT/);
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
    fs.writeFileSync(targetPath, "hello");
    fs.symlinkSync(targetPath, symlinkPath);

    expect(pathEntryExistsSync(symlinkPath, [allowedDir])).toBe(true);

    removeFileSync(symlinkPath, [allowedDir]);

    expect(fs.existsSync(targetPath)).toBe(true);
    expect(() => fs.lstatSync(symlinkPath)).toThrow(/ENOENT/);
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
    fs.writeFileSync(targetPath, "hello");
    fs.symlinkSync(targetPath, sourcePath);

    renamePathSync(sourcePath, destinationPath, [allowedDir]);

    expect(fs.existsSync(targetPath)).toBe(true);
    expect(() => fs.lstatSync(sourcePath)).toThrow(/ENOENT/);
    expect(fs.lstatSync(destinationPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(destinationPath)).toBe(targetPath);
  });
});
