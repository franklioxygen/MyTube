import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteHook, getHookStatus, uploadHook } from "../../controllers/hookController";
import { HookService } from "../../services/hookService";

// Mock dependencies
vi.mock("../../services/hookService");

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
    });

    describe("uploadHook", () => {
        it("should upload valid hook", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("#!/bin/bash\necho hello") } as any;
            
            await uploadHook(req as Request, res as Response);
            
            expect(HookService.uploadHook).toHaveBeenCalledWith("task_success", expect.any(Buffer));
            expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("should throw if no file uploaded", async () => {
            req.params = { name: "task_success" };
            
            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("No file uploaded");
        });

        it("should throw if invalid hook name", async () => {
            req.params = { name: "invalid_hook" };
            req.file = { buffer: Buffer.from("#!/bin/bash\necho hello") } as any;
            
            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Invalid hook name");
        });

        it("should reject risky content", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("rm -rf /") } as any;
            
            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Risk command detected");
            expect(HookService.uploadHook).not.toHaveBeenCalled();
        });

        it("should throw when uploaded file is empty", async () => {
             req.params = { name: "task_success" };
             req.file = { buffer: Buffer.alloc(0) } as any;

             await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Uploaded file is empty");
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
