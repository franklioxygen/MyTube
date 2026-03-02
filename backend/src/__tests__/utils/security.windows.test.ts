import { afterEach, describe, expect, it, vi } from "vitest";

async function loadSecurityWithWin32Path() {
  vi.resetModules();
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

  return import("../../utils/security");
}

describe("security windows paths", () => {
  afterEach(() => {
    vi.doUnmock("path");
    vi.resetModules();
  });

  it("resolves absolute drive-letter paths without duplication", async () => {
    const security = await loadSecurityWithWin32Path();
    const allowedDir = "D:\\Software\\MyTube\\backend\\uploads\\videos";
    const filePath = `${allowedDir}\\video_1772440055028.mp4`;

    const resolved = security.resolveSafePath(filePath, allowedDir);

    expect(resolved).toBe(filePath);
    expect(resolved).not.toContain("D:\\D:\\");
  });

  it("validates drive-letter paths inside/outside allowed directory", async () => {
    const security = await loadSecurityWithWin32Path();
    const allowedDir = "D:\\Software\\MyTube\\backend\\uploads\\videos";
    const insidePath = `${allowedDir}\\movie.mp4`;
    const outsidePath = "E:\\Other\\movie.mp4";

    expect(security.validatePathWithinDirectory(insidePath, allowedDir)).toBe(
      true,
    );
    expect(security.validatePathWithinDirectory(outsidePath, allowedDir)).toBe(
      false,
    );
  });
});
