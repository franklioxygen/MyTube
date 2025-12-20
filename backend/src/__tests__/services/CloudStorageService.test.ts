import axios from "axios";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudStorageService } from "../../services/CloudStorageService";
import * as storageService from "../../services/storageService";

// Mock db module before any imports that might use it
vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  sqlite: {
    prepare: vi.fn(),
  },
}));

vi.mock("axios");
vi.mock("fs-extra");
vi.mock("../../services/storageService");

describe("CloudStorageService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.error = vi.fn();
    // Ensure axios.put is properly mocked
    (axios.put as any) = vi.fn();
  });

  describe("uploadVideo", () => {
    it("should return early if cloud drive is not enabled", async () => {
      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: false,
      });

      await CloudStorageService.uploadVideo({ title: "Test Video" });

      expect(axios.put).not.toHaveBeenCalled();
    });

    it("should return early if apiUrl is missing", async () => {
      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "",
        openListToken: "token",
      });

      await CloudStorageService.uploadVideo({ title: "Test Video" });

      expect(axios.put).not.toHaveBeenCalled();
    });

    it("should return early if token is missing", async () => {
      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "",
      });

      await CloudStorageService.uploadVideo({ title: "Test Video" });

      expect(axios.put).not.toHaveBeenCalled();
    });

    it("should upload video file when path exists", async () => {
      const mockVideoData = {
        title: "Test Video",
        videoPath: "/videos/test.mp4",
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024, mtime: { getTime: () => Date.now() } });
      (fs.createReadStream as any).mockReturnValue({});
      (axios.put as any).mockResolvedValue({ 
        status: 200,
        data: { code: 200, message: "Success" }
      });

      // Mock resolveAbsolutePath by making fs.existsSync return true for data dir
      (fs.existsSync as any).mockImplementation((p: string) => {
        if (
          p.includes("data") &&
          !p.includes("videos") &&
          !p.includes("images")
        ) {
          return true;
        }
        if (p.includes("test.mp4") || p.includes("videos")) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(axios.put).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
      const logCall = (console.log as any).mock.calls.find((call: any[]) =>
        call[0]?.includes("[CloudStorage] Starting upload for video: Test Video")
      );
      expect(logCall).toBeDefined();
    });

    it("should upload thumbnail when path exists", async () => {
      const mockVideoData = {
        title: "Test Video",
        thumbnailPath: "/images/thumb.jpg",
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 512, mtime: { getTime: () => Date.now() } });
      (fs.createReadStream as any).mockReturnValue({});
      (axios.put as any).mockResolvedValue({ 
        status: 200,
        data: { code: 200, message: "Success" }
      });

      (fs.existsSync as any).mockImplementation((p: string) => {
        if (
          p.includes("data") &&
          !p.includes("videos") &&
          !p.includes("images")
        ) {
          return true;
        }
        if (p.includes("thumb.jpg") || p.includes("images")) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(axios.put).toHaveBeenCalled();
    });

    it("should upload metadata JSON file", async () => {
      const mockVideoData = {
        title: "Test Video",
        description: "Test description",
        author: "Test Author",
        sourceUrl: "https://example.com",
        tags: ["tag1", "tag2"],
        createdAt: "2024-01-01",
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      (fs.existsSync as any).mockImplementation((p: string) => {
        // Return true for temp_metadata files and their directory
        if (p.includes("temp_metadata")) {
          return true;
        }
        return true;
      });
      (fs.ensureDirSync as any).mockReturnValue(undefined);
      (fs.writeFileSync as any).mockReturnValue(undefined);
      (fs.statSync as any).mockReturnValue({ size: 256, mtime: { getTime: () => Date.now() } });
      (fs.createReadStream as any).mockReturnValue({});
      (fs.unlinkSync as any).mockReturnValue(undefined);
      (axios.put as any).mockResolvedValue({ 
        status: 200,
        data: { code: 200, message: "Success" }
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(fs.ensureDirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(axios.put).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("should handle missing video file gracefully", async () => {
      const mockVideoData = {
        title: "Test Video",
        videoPath: "/videos/missing.mp4",
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      // Mock existsSync to return false for video file, but true for data dir and temp_metadata
      (fs.existsSync as any).mockImplementation((p: string) => {
        if (
          p.includes("data") &&
          !p.includes("videos") &&
          !p.includes("images")
        ) {
          return true;
        }
        if (p.includes("temp_metadata")) {
          return true;
        }
        if (p.includes("missing.mp4") || p.includes("videos")) {
          return false;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(console.error).toHaveBeenCalled();
      const errorCall = (console.error as any).mock.calls.find((call: any[]) =>
        call[0]?.includes("[CloudStorage] Video file not found: /videos/missing.mp4")
      );
      expect(errorCall).toBeDefined();
      // Metadata will still be uploaded even if video is missing
      // So we check that video upload was not attempted
      const putCalls = (axios.put as any).mock.calls;
      const videoUploadCalls = putCalls.filter(
        (call: any[]) => call[0] && call[0].includes("missing.mp4")
      );
      expect(videoUploadCalls.length).toBe(0);
    });

    it("should handle upload errors gracefully", async () => {
      const mockVideoData = {
        title: "Test Video",
        videoPath: "/videos/test.mp4",
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024, mtime: { getTime: () => Date.now() } });
      (fs.createReadStream as any).mockReturnValue({});
      (axios.put as any).mockRejectedValue(new Error("Upload failed"));

      (fs.existsSync as any).mockImplementation((p: string) => {
        if (
          p.includes("data") &&
          !p.includes("videos") &&
          !p.includes("images")
        ) {
          return true;
        }
        if (p.includes("test.mp4")) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(console.error).toHaveBeenCalled();
      const errorCall = (console.error as any).mock.calls.find((call: any[]) =>
        call[0]?.includes("[CloudStorage] Upload failed for Test Video:")
      );
      expect(errorCall).toBeDefined();
      expect(errorCall[1]).toBeInstanceOf(Error);
    });

    it("should sanitize filename for metadata", async () => {
      const mockVideoData = {
        title: "Test Video (2024)",
        description: "Test",
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.ensureDirSync as any).mockReturnValue(undefined);
      (fs.writeFileSync as any).mockReturnValue(undefined);
      (fs.statSync as any).mockReturnValue({ size: 256, mtime: { getTime: () => Date.now() } });
      (fs.createReadStream as any).mockReturnValue({});
      (fs.unlinkSync as any).mockReturnValue(undefined);
      (axios.put as any).mockResolvedValue({ 
        status: 200,
        data: { code: 200, message: "Success" }
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(fs.writeFileSync).toHaveBeenCalled();
      const metadataPath = (fs.writeFileSync as any).mock.calls[0][0];
      // The sanitize function replaces non-alphanumeric with underscore, so ( becomes _
      expect(metadataPath).toContain("test_video__2024_.json");
    });
  });

  describe("uploadFile error handling", () => {
    it("should throw NetworkError on HTTP error response", async () => {
      const mockVideoData = {
        title: "Test Video",
        videoPath: "/videos/test.mp4",
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024, mtime: { getTime: () => Date.now() } });
      (fs.createReadStream as any).mockReturnValue({});

      const axiosError = {
        response: {
          status: 500,
        },
        message: "Internal Server Error",
      };
      (axios.put as any).mockRejectedValue(axiosError);

      (fs.existsSync as any).mockImplementation((p: string) => {
        if (
          p.includes("data") &&
          !p.includes("videos") &&
          !p.includes("images")
        ) {
          return true;
        }
        if (p.includes("test.mp4")) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(console.error).toHaveBeenCalled();
    });

    it("should handle network timeout errors", async () => {
      const mockVideoData = {
        title: "Test Video",
        videoPath: "/videos/test.mp4",
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024, mtime: { getTime: () => Date.now() } });
      (fs.createReadStream as any).mockReturnValue({});

      const axiosError = {
        request: {},
        message: "Timeout",
      };
      (axios.put as any).mockRejectedValue(axiosError);

      (fs.existsSync as any).mockImplementation((p: string) => {
        if (
          p.includes("data") &&
          !p.includes("videos") &&
          !p.includes("images")
        ) {
          return true;
        }
        if (p.includes("test.mp4")) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(console.error).toHaveBeenCalled();
    });

    it("should handle file not found errors", async () => {
      const mockVideoData = {
        title: "Test Video",
        videoPath: "/videos/test.mp4",
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024, mtime: { getTime: () => Date.now() } });
      (fs.createReadStream as any).mockReturnValue({});

      const axiosError = {
        code: "ENOENT",
        message: "File not found",
      };
      (axios.put as any).mockRejectedValue(axiosError);

      (fs.existsSync as any).mockImplementation((p: string) => {
        if (
          p.includes("data") &&
          !p.includes("videos") &&
          !p.includes("images")
        ) {
          return true;
        }
        if (p.includes("test.mp4")) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("getSignedUrl", () => {
    it("should coalesce multiple requests for the same file", async () => {
      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      // Clear caches before test
      CloudStorageService.clearCache();

      // Mock getFileList to take some time and return success
      (axios.post as any) = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          status: 200,
          data: {
            code: 200,
            data: {
              content: [
                {
                  name: "test.mp4",
                  sign: "test-sign",
                },
              ],
            },
          },
        };
      });

      // Launch multiple concurrent requests
      const promises = [
        CloudStorageService.getSignedUrl("test.mp4", "video"),
        CloudStorageService.getSignedUrl("test.mp4", "video"),
        CloudStorageService.getSignedUrl("test.mp4", "video"),
      ];

      const results = await Promise.all(promises);

      // Verify all requests returned the same URL
      expect(results[0]).toBeDefined();
      expect(results[0]).toContain("sign=test-sign");
      expect(results[1]).toBe(results[0]);
      expect(results[2]).toBe(results[0]);

      // Verify that axios.post was only called once
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it("should cache results", async () => {
      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: "https://api.example.com",
        openListToken: "test-token",
        cloudDrivePath: "/uploads",
      });

      // Clear caches before test
      CloudStorageService.clearCache();

      // Mock getFileList
      (axios.post as any) = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          code: 200,
          data: {
            content: [
              {
                name: "test.mp4",
                sign: "test-sign",
              },
            ],
          },
        },
      });

      // First request
      await CloudStorageService.getSignedUrl("test.mp4", "video");

      // Second request (should hit cache)
      const url = await CloudStorageService.getSignedUrl("test.mp4", "video");

      expect(url).toContain("sign=test-sign");
      // Should be called once for first request, and 0 times for second (cached)
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });
});
