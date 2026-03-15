import { afterEach, describe, expect, it, vi } from "vitest";

async function loadFileSystemAccessWithWin32Path() {
  vi.resetModules();

  const existsSync = vi.fn(() => true);
  const lstatSync = vi.fn(() => ({
    isSymbolicLink: () => false,
  }));
  const realpathSync = vi.fn((targetPath: string) => targetPath);

  vi.doMock("path", async () => {
    const actual = await vi.importActual<typeof import("path")>("path");
    const win = actual.win32;
    return {
      default: win,
      ...win,
      posix: actual.posix,
      win32: actual.win32,
    };
  });

  vi.doMock("fs-extra", () => ({
    default: {
      existsSync,
      lstatSync,
      realpathSync,
    },
    existsSync,
    lstatSync,
    realpathSync,
  }));

  return {
    ...(await import("../../utils/fileSystemAccess")),
    existsSync,
  };
}

describe("fileSystemAccess windows paths", () => {
  afterEach(() => {
    vi.doUnmock("path");
    vi.doUnmock("fs-extra");
    vi.resetModules();
  });

  it("allows drive-letter paths when casing differs", async () => {
    const fileSystemAccess = await loadFileSystemAccessWithWin32Path();
    const allowedDir = "C:\\media";
    const filePath = "c:\\media\\movie.mp4";

    expect(fileSystemAccess.pathExistsSync(filePath, [allowedDir])).toBe(true);
    expect(fileSystemAccess.existsSync).toHaveBeenCalledWith(filePath);
  });
});
