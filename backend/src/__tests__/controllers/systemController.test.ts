import axios from "axios";
import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestVersion } from "../../controllers/systemController";

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
        
        // Setup axios.isAxiosError helper
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
        // First call fails with 404
        vi.mocked(axios.get).mockImplementationOnce(() => Promise.reject({
            isAxiosError: true,
            response: { status: 404 }
        }));

        // Second call (tags) succeeds
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
});
