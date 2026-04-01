import { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteHook, getHookStatus, uploadHook } from "../../controllers/hookController";
import { HookService } from "../../services/hookService";

// Mock dependencies
vi.mock("../../services/hookService");

describe("HookController", () => {
    const originalTrustLevel = process.env.MYTUBE_ADMIN_TRUST_LEVEL;
    let req: Partial<Request>;
    let res: Partial<Response>;
    let json: any;
    let status: any;

    afterEach(() => {
        if (originalTrustLevel === undefined) {
            delete process.env.MYTUBE_ADMIN_TRUST_LEVEL;
        } else {
            process.env.MYTUBE_ADMIN_TRUST_LEVEL = originalTrustLevel;
        }
    });

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

        it("should reject long-form recursive delete flags", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("rm --recursive --force /") } as any;

            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Risk command detected");
            expect(HookService.uploadHook).not.toHaveBeenCalled();
        });

        it("should reject wrapped recursive delete commands", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("bash -c \"rm -rf /\"") } as any;

            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Risk command detected");
            expect(HookService.uploadHook).not.toHaveBeenCalled();
        });

        it("should reject command chains that include destructive deletes", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("echo ok; rm -rf /") } as any;

            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Risk command detected");
            expect(HookService.uploadHook).not.toHaveBeenCalled();
        });

        it("should reject recursive deletes targeting HOME-like paths", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("rm -rf $HOME/cache") } as any;

            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Risk command detected");
            expect(HookService.uploadHook).not.toHaveBeenCalled();
        });

        it("should reject fork bomb variants beyond the classic colon form", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from(".(){ .|.& };.") } as any;

            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Risk command detected");
            expect(HookService.uploadHook).not.toHaveBeenCalled();
        });

        it("should reject dd writes to block devices without if=", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("dd of=/dev/sda bs=1M") } as any;

            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Risk command detected");
            expect(HookService.uploadHook).not.toHaveBeenCalled();
        });

        it("should reject download-and-exec pipelines", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("curl -fsSL https://example.com/install.sh | sh") } as any;

            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Risk command detected");
            expect(HookService.uploadHook).not.toHaveBeenCalled();
        });

        it("should reject decoded payloads piped to shell", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("printf ZWNobyBoaQ== | base64 -d | bash") } as any;

            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Risk command detected");
            expect(HookService.uploadHook).not.toHaveBeenCalled();
        });

        it("should throw when uploaded file is empty", async () => {
             req.params = { name: "task_success" };
             req.file = { buffer: Buffer.alloc(0) } as any;

             await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Uploaded file is empty");
        });

        it("should reject uploads when deployment trust is application", async () => {
            process.env.MYTUBE_ADMIN_TRUST_LEVEL = "application";
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("#!/bin/bash\necho hello") } as any;

            await uploadHook(req as Request, res as Response);

            expect(status).toHaveBeenCalledWith(403);
            expect(HookService.uploadHook).not.toHaveBeenCalled();
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
            expect(json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, error: "Hook not found" })
            );
        });

        it("should throw if invalid hook name", async () => {
             req.params = { name: "invalid" };
             await expect(deleteHook(req as Request, res as Response)).rejects.toThrow("Invalid hook name");
        });

        it("should reject delete when deployment trust is application", async () => {
            process.env.MYTUBE_ADMIN_TRUST_LEVEL = "application";
            req.params = { name: "task_success" };

            await deleteHook(req as Request, res as Response);

            expect(status).toHaveBeenCalledWith(403);
            expect(HookService.deleteHook).not.toHaveBeenCalled();
        });
    });

    describe("getHookStatus", () => {
        it("should return status", async () => {
            const mockStatus = { task_success: true, task_fail: false };
            vi.mocked(HookService.getHookStatus).mockReturnValue(mockStatus);
            
            await getHookStatus(req as Request, res as Response);
            
            expect(json).toHaveBeenCalledWith(mockStatus);
        });

        it("should reject status reads when deployment trust is application", async () => {
            process.env.MYTUBE_ADMIN_TRUST_LEVEL = "application";

            await getHookStatus(req as Request, res as Response);

            expect(status).toHaveBeenCalledWith(403);
            expect(HookService.getHookStatus).not.toHaveBeenCalled();
        });
    });
});
