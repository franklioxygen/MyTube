import { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/ytdlp/maintenance", () => ({
  getYtDlpStatus: vi.fn(),
  updateYtDlp: vi.fn(),
}));

import {
  getYtDlpVersion,
  updateYtDlpVersion,
} from "../../controllers/ytDlpController";
import { getYtDlpStatus, updateYtDlp } from "../../utils/ytdlp/maintenance";

const statusMock = vi.mocked(getYtDlpStatus);
const updateMock = vi.mocked(updateYtDlp);

const buildStatus = (overrides: Record<string, unknown> = {}) =>
  ({
    version: "2026.08.19",
    path: "/usr/local/bin/yt-dlp",
    available: true,
    isStale: false,
    staleAfterDays: 90,
    latestVersion: "2026.8.19",
    updateAvailable: false,
    updateSupported: true,
    customPathConfigured: false,
    ...overrides,
  }) as Awaited<ReturnType<typeof getYtDlpStatus>>;

describe("ytDlpController", () => {
  const originalTrustLevel = process.env.MYTUBE_ADMIN_TRUST_LEVEL;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: ReturnType<typeof vi.fn>;
  let status: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    statusMock.mockResolvedValue(buildStatus());
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = { query: {} };
    res = { json, status } as unknown as Response;
  });

  afterEach(() => {
    if (originalTrustLevel === undefined) {
      delete process.env.MYTUBE_ADMIN_TRUST_LEVEL;
    } else {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = originalTrustLevel;
    }
  });

  describe("getYtDlpVersion", () => {
    it("returns the yt-dlp status", async () => {
      await getYtDlpVersion(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith({ checkLatest: true });
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ version: "2026.08.19" }),
        })
      );
    });

    it("honours checkLatest=false to skip the PyPI lookup", async () => {
      req.query = { checkLatest: "false" };

      await getYtDlpVersion(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith({ checkLatest: false });
    });
  });

  describe("updateYtDlpVersion", () => {
    it("updates yt-dlp and returns the result", async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = "container";
      updateMock.mockResolvedValue({
        previousVersion: "2026.06.09",
        status: buildStatus(),
        changed: true,
      });

      await updateYtDlpVersion(req as Request, res as Response);

      expect(updateMock).toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ changed: true }),
        })
      );
    });

    it("refuses in application trust mode", async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = "application";

      await updateYtDlpVersion(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(403);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("refuses when YT_DLP_PATH pins a binary", async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = "container";
      statusMock.mockResolvedValue(
        buildStatus({ updateSupported: false, customPathConfigured: true })
      );

      await updateYtDlpVersion(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorKey: "ytDlpUpdateCustomPath",
        })
      );
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("returns 500 with the failure reason when pip fails", async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = "container";
      updateMock.mockRejectedValue(new Error("pip missing"));

      await updateYtDlpVersion(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "pip missing",
          errorKey: "ytDlpUpdateFailed",
        })
      );
    });
  });
});
