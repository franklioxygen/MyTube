import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { isRealPathInsideDir } from "../../utils/security";

/**
 * Every other containment check in utils/security is lexical: it validates the
 * string form of a path. That stops `..` traversal but cannot see a directory
 * INSIDE the allowed root that has been replaced by a symlink - after which fs
 * follows it on every call, an lstat of the final component reports an ordinary
 * file, and reads, writes and unlinks all land outside the root.
 */
describe("isRealPathInsideDir", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-realpath-"));
  const allowed = path.join(root, "allowed");
  const outside = path.join(root, "outside");

  beforeEach(() => {
    fs.emptyDirSync(root);
    fs.ensureDirSync(allowed);
    fs.ensureDirSync(outside);
  });

  afterAll(() => {
    fs.removeSync(root);
  });

  it("accepts an ordinary path inside the root", () => {
    const target = path.join(allowed, "Show/Season 01/ep.mp4");
    fs.ensureDirSync(path.dirname(target));
    fs.writeFileSync(target, "bytes", "utf8");

    expect(isRealPathInsideDir(target, allowed)).toBe(true);
  });

  it("accepts a path that does not exist yet under an existing ancestor", () => {
    // Confining the deepest existing ancestor confines what will be created
    // beneath it.
    fs.ensureDirSync(path.join(allowed, "Show"));

    expect(
      isRealPathInsideDir(path.join(allowed, "Show/Season 01/new.nfo"), allowed)
    ).toBe(true);
  });

  it("accepts the root itself", () => {
    expect(isRealPathInsideDir(allowed, allowed)).toBe(true);
  });

  it("rejects a path reached through a symlinked ancestor", () => {
    fs.writeFileSync(path.join(outside, "victim.mp4"), "USER DATA", "utf8");
    // A show directory inside the root becomes a link to somewhere else.
    fs.symlinkSync(outside, path.join(allowed, "Show"));

    const target = path.join(allowed, "Show/victim.mp4");
    // Lexically it looks contained, which is exactly the trap.
    expect(target.startsWith(allowed + path.sep)).toBe(true);
    expect(isRealPathInsideDir(target, allowed)).toBe(false);
  });

  it("rejects a not-yet-existing path under a symlinked ancestor", () => {
    fs.symlinkSync(outside, path.join(allowed, "Show"));

    expect(
      isRealPathInsideDir(path.join(allowed, "Show/brand-new.nfo"), allowed)
    ).toBe(false);
  });

  it("rejects a plain path outside the root", () => {
    fs.writeFileSync(path.join(outside, "x.mp4"), "bytes", "utf8");

    expect(isRealPathInsideDir(path.join(outside, "x.mp4"), allowed)).toBe(false);
  });

  it("rejects unusable arguments rather than guessing", () => {
    expect(isRealPathInsideDir("", allowed)).toBe(false);
    expect(isRealPathInsideDir(path.join(allowed, "x"), "")).toBe(false);
    expect(isRealPathInsideDir(undefined as unknown as string, allowed)).toBe(false);
    expect(isRealPathInsideDir(path.join(allowed, "x"), undefined as unknown as string)).toBe(false);
  });

  it("falls back to a lexical resolution when the root does not exist", () => {
    const missingRoot = path.join(root, "never-created");

    // Nothing can be inside a root that is not there, but it must not throw.
    expect(() =>
      isRealPathInsideDir(path.join(missingRoot, "a/b"), missingRoot)
    ).not.toThrow();
  });
});
