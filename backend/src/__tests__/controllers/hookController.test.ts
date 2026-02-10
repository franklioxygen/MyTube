import { Request, Response } from "express";
import fs from "fs";
import os from "os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteHook, getHookStatus, uploadHook } from "../../controllers/hookController";
import { HookService } from "../../services/hookService";
import {
  resolveSafePathInDirectories,
  validatePathWithinDirectory,
} from "../../utils/security";

// Mock dependencies
vi.mock("fs");
// Mocking 'path' can be dangerous as generic utils use it, but validPathWithinDirectory uses it.
// We'll trust real path if possible, or assume specific paths.
// os.tmpdir
vi.mock("os");
vi.mock("../../services/hookService");
vi.mock("../../utils/security", () => ({
  resolveSafePathInDirectories: vi.fn((path: string) => path),
  validatePathWithinDirectory: vi.fn(),
}));

describe("HookController", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let json: any;
    let status: any;

    beforeEach(() => {
        vi.clearAllMocks();
        json = vi.fn();
        status = vi.fn().mockReturnValue({ json });
        
        req = {
            params: {},
            body: {},
        };
        res = {
            json,
            status,
        } as unknown as Response;

        vi.mocked(os.tmpdir).mockReturnValue("/tmp");
        vi.mocked(resolveSafePathInDirectories).mockImplementation(
          (inputPath: string) => inputPath
        );
        vi.mocked(validatePathWithinDirectory).mockReturnValue(true);
    });

    describe("uploadHook", () => {
        it("should upload valid hook", async () => {
            req.params = { name: "task_success" };
            req.file = { path: "/tmp/upload" } as any;
            
            // Mock file content (safe)
            vi.mocked(fs.readFileSync).mockReturnValue("#!/bin/bash\necho hello");
            
            await uploadHook(req as Request, res as Response);
            
            expect(HookService.uploadHook).toHaveBeenCalledWith("task_success", expect.stringContaining("upload"));
            expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("should throw if no file uploaded", async () => {
            req.params = { name: "task_success" };
            
            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("No file uploaded");
        });

        it("should throw if invalid hook name", async () => {
            req.params = { name: "invalid_hook" };
            req.file = { path: "/tmp/upload" } as any;
            
            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Invalid hook name");
        });

        it("should reject risky content", async () => {
            req.params = { name: "task_success" };
            req.file = { path: "/tmp/upload" } as any;
            
            // Mock file content (risky)
            vi.mocked(fs.readFileSync).mockReturnValue("rm -rf /");
            
            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Risk command detected");
            expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining("upload"));
            expect(HookService.uploadHook).not.toHaveBeenCalled();
        });

        it("should throw if path traversal detected", async () => {
             req.params = { name: "task_success" };
             req.file = { path: "/tmp/upload" } as any;
             vi.mocked(resolveSafePathInDirectories).mockImplementation(() => {
               throw new Error("unsafe path");
             });

             await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Invalid file path");
        });
    });

    describe("deleteHook", () => {
        it("should delete existing hook", async () => {
            req.params = { name: "task_success" };
            vi.mocked(HookService.deleteHook).mockReturnValue(true);
            
            await deleteHook(req as Request, res as Response);
            
            expect(HookService.deleteHook).toHaveBeenCalledWith("task_success");
            expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("should return 404 if hook not found", async () => {
            req.params = { name: "task_success" };
            vi.mocked(HookService.deleteHook).mockReturnValue(false);
            
            await deleteHook(req as Request, res as Response);
            
            expect(status).toHaveBeenCalledWith(404);
        });

        it("should throw if invalid hook name", async () => {
             req.params = { name: "invalid" };
             await expect(deleteHook(req as Request, res as Response)).rejects.toThrow("Invalid hook name");
        });
    });

    describe("getHookStatus", () => {
        it("should return status", async () => {
            const mockStatus = { task_success: true, task_fail: false };
            vi.mocked(HookService.getHookStatus).mockReturnValue(mockStatus);
            
            await getHookStatus(req as Request, res as Response);
            
            expect(json).toHaveBeenCalledWith(mockStatus);
        });
    });
});
