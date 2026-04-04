import { beforeEach, describe, expect, it, vi } from "vitest";

const securityMocks = vi.hoisted(() => ({
  ensureDirSafeSync: vi.fn(),
  moveSafeSync: vi.fn(),
  pathExistsSafeSync: vi.fn(),
  resolveSafeChildPath: vi.fn((root: string, child: string) => `${root}/${child}`),
  unlinkSafeSync: vi.fn(),
  writeFileSafeSync: vi.fn(),
}));

vi.mock("../../utils/security", () => securityMocks);
vi.mock("../../utils/logger");

import * as cookieService from "../../services/cookieService";

describe("cookieService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    securityMocks.pathExistsSafeSync.mockReturnValue(false);
  });

  describe("checkCookies", () => {
    it("should return true if file exists", () => {
      securityMocks.pathExistsSafeSync.mockReturnValue(true);
      expect(cookieService.checkCookies()).toEqual({ exists: true });
    });

    it("should return false if file does not exist", () => {
      securityMocks.pathExistsSafeSync.mockReturnValue(false);
      expect(cookieService.checkCookies()).toEqual({ exists: false });
    });
  });

  describe("uploadCookies", () => {
    it("should write and move uploaded buffer to destination", () => {
      cookieService.uploadCookies(Buffer.from("cookie-data"));

      expect(securityMocks.writeFileSafeSync).toHaveBeenCalledWith(
        expect.stringContaining("cookies.txt.tmp"),
        expect.any(String),
        expect.any(Buffer),
      );
      expect(securityMocks.moveSafeSync).toHaveBeenCalledWith(
        expect.stringContaining("cookies.txt.tmp"),
        expect.any(String),
        expect.stringContaining("cookies.txt"),
        expect.any(String),
        { overwrite: true },
      );
    });

    it("should cleanup temporary file on error", () => {
      securityMocks.moveSafeSync.mockImplementation(() => {
        throw new Error("Move failed");
      });
      securityMocks.pathExistsSafeSync.mockReturnValue(true);

      expect(() => cookieService.uploadCookies(Buffer.from("cookie-data"))).toThrow(
        "Move failed",
      );
      expect(securityMocks.unlinkSafeSync).toHaveBeenCalledWith(
        expect.stringContaining("cookies.txt.tmp"),
        expect.any(String),
      );
    });
  });

  describe("deleteCookies", () => {
    it("should delete file if exists", () => {
      securityMocks.pathExistsSafeSync.mockReturnValue(true);
      cookieService.deleteCookies();
      expect(securityMocks.unlinkSafeSync).toHaveBeenCalled();
    });

    it("should throw if file does not exist", () => {
      securityMocks.pathExistsSafeSync.mockReturnValue(false);
      expect(() => cookieService.deleteCookies()).toThrow("Cookies file not found");
    });
  });
});
