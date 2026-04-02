import axios from "axios";
import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestVersion } from "../../controllers/systemController";
import { logger } from "../../utils/logger";

// Mock dependencies
vi.mock("axios");

// Mock version module
vi.mock("../../version", () => ({
  VERSION: { number: "1.0.0" }
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SystemController", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    req = {};
    res = {
      json,
    } as unknown as Response;

    (axios.isAxiosError as any) = vi.fn((payload) => payload?.isAxiosError === true);
  });

  it("should return update info when newer release found", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        tag_name: "v1.1.0",
        html_url: "http://release"
      }
    });

    await getLatestVersion(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      releaseUrl: "http://release",
      hasUpdate: true
    });
  });

  it("should fallback to tags if release not found (404)", async () => {
    vi.mocked(axios.get).mockImplementationOnce(() => Promise.reject({
      isAxiosError: true,
      response: { status: 404 }
    }));
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: [
        { name: "v1.0.1" }
      ]
    });

    await getLatestVersion(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({
      currentVersion: "1.0.0",
      latestVersion: "1.0.1",
      releaseUrl: expect.stringContaining("v1.0.1"),
      hasUpdate: true
    });
  });

  it("should handle fallback to tags when releases return 404", async () => {
    const axiosError = new Error("Not Found") as any;
    axiosError.isAxiosError = true;
    axiosError.response = { status: 404 };
    vi.mocked(axios.isAxiosError).mockReturnValue(true);

    vi.mocked(axios.get)
      .mockRejectedValueOnce(axiosError)
      .mockResolvedValueOnce({
        data: [{
          name: "v1.2.0",
          zipball_url: "...",
          tarball_url: "...",
        }]
      });

    await getLatestVersion(req as Request, res as Response);

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(json).toHaveBeenCalledWith({
      currentVersion: "1.0.0",
      latestVersion: "1.2.0",
      releaseUrl: "https://github.com/franklioxygen/mytube/releases/tag/v1.2.0",
      hasUpdate: true,
    });
  });

  it("should handle error gracefully", async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error("Network Error"));

    await getLatestVersion(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({
      currentVersion: "1.0.0",
      latestVersion: "1.0.0",
      releaseUrl: "",
      hasUpdate: false,
      error: "Failed to check for updates"
    });
  });

  it("should return current version on error", async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error("Network Error"));
    vi.mocked(axios.isAxiosError).mockReturnValue(false);

    await getLatestVersion(req as Request, res as Response);

    expect(logger.error).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({
      currentVersion: "1.0.0",
      latestVersion: "1.0.0",
      releaseUrl: "",
      hasUpdate: false,
      error: "Failed to check for updates",
    });
  });

  it("should indicate no update if versions match", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        tag_name: "v1.0.0",
        html_url: "http://release"
      }
    });

    await getLatestVersion(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      hasUpdate: false
    }));
  });

  it("should handle version comparison correctly for complex versions", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        tag_name: "v1.0.1",
        html_url: "url",
      },
    });

    await getLatestVersion(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({
      currentVersion: "1.0.0",
      latestVersion: "1.0.1",
      releaseUrl: "url",
      hasUpdate: true,
    });
  });
});
