import { Request, Response } from "express";
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { deleteHook, getHookStatus, uploadHook } from "../../controllers/hookController";
import { HookService } from "../../services/hookService";
import {
  createStrictFeatureDisabledPayload,
  isStrictFeatureDisabled,
} from "../../utils/strictSecurity";

vi.mock("../../utils/strictSecurity", () => ({
    isStrictFeatureDisabled: vi.fn(),
    createStrictFeatureDisabledPayload: vi.fn(() => ({
        success: false,
        error: "feature disabled",
        feature: "hooks",
    })),
}));

describe("HookController", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let json: any;
    let status: any;
    let uploadHookSpy: MockInstance<typeof HookService.uploadHook>;
    let deleteHookSpy: MockInstance<typeof HookService.deleteHook>;
    let getHookStatusSpy: MockInstance<typeof HookService.getHookStatus>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isStrictFeatureDisabled).mockReturnValue(false);
        uploadHookSpy = vi
          .spyOn(HookService, "uploadHook")
          .mockImplementation(() => undefined);
        deleteHookSpy = vi
          .spyOn(HookService, "deleteHook")
          .mockReturnValue(false);
        getHookStatusSpy = vi
          .spyOn(HookService, "getHookStatus")
          .mockReturnValue({});
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
            req.file = {
              originalname: "task_success.json",
              buffer: Buffer.from(
                JSON.stringify({
                  actions: [
                    {
                      type: "notify_webhook",
                      url: "https://example.com/hook",
                      method: "POST",
                    },
                  ],
                })
              ),
            } as any;
            
            await uploadHook(req as Request, res as Response);
            
            expect(uploadHookSpy).toHaveBeenCalledWith(
              "task_success",
              expect.any(Buffer),
              "task_success.json"
            );
            expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("should upload legacy shell hook in legacy mode", async () => {
            req.params = { name: "task_fail" };
            req.file = {
              originalname: "task_fail.sh",
              buffer: Buffer.from("#!/bin/sh\necho hi\n", "utf-8"),
            } as any;

            await uploadHook(req as Request, res as Response);

            expect(uploadHookSpy).toHaveBeenCalledWith(
              "task_fail",
              expect.any(Buffer),
              "task_fail.sh"
            );
            expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("should throw if no file uploaded", async () => {
            req.params = { name: "task_success" };
            
            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("No file uploaded");
        });

        it("should throw if invalid hook name", async () => {
            req.params = { name: "invalid_hook" };
            req.file = { buffer: Buffer.from("{}") } as any;
            
            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Invalid hook name");
        });

        it("should return validation error when hook definition is invalid", async () => {
            req.params = { name: "task_success" };
            req.file = { originalname: "task_success.json", buffer: Buffer.from("not json") } as any;
            uploadHookSpy.mockImplementation(() => {
              throw new Error("Hook definition must be valid JSON");
            });

            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow(
              "Hook definition must be valid JSON"
            );
        });

        it("should return validation error for unsupported hook extension", async () => {
            req.params = { name: "task_success" };
            req.file = { originalname: "task_success.txt", buffer: Buffer.from("hello") } as any;
            uploadHookSpy.mockImplementation(() => {
              throw new Error("Hook file must be .json, .sh, or .bash");
            });

            await expect(uploadHook(req as Request, res as Response)).rejects.toThrow(
              "Hook file must be .json, .sh, or .bash"
            );
        });

        it("should throw when uploaded file is empty", async () => {
             req.params = { name: "task_success" };
             req.file = { originalname: "task_success.json", buffer: Buffer.alloc(0) } as any;

             await expect(uploadHook(req as Request, res as Response)).rejects.toThrow("Uploaded file is empty");
        });

        it("should return 403 when hooks are disabled in strict mode", async () => {
            req.params = { name: "task_success" };
            req.file = { buffer: Buffer.from("{}") } as any;
            vi.mocked(isStrictFeatureDisabled).mockReturnValue(true);

            await uploadHook(req as Request, res as Response);

            expect(status).toHaveBeenCalledWith(403);
            expect(createStrictFeatureDisabledPayload).toHaveBeenCalledWith("hooks");
            expect(uploadHookSpy).not.toHaveBeenCalled();
        });
    });

    describe("deleteHook", () => {
        it("should delete existing hook", async () => {
            req.params = { name: "task_success" };
            deleteHookSpy.mockReturnValue(true);
            
            await deleteHook(req as Request, res as Response);
            
            expect(deleteHookSpy).toHaveBeenCalledWith("task_success");
            expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it("should return 404 if hook not found", async () => {
            req.params = { name: "task_success" };
            deleteHookSpy.mockReturnValue(false);
            
            await deleteHook(req as Request, res as Response);
            
            expect(status).toHaveBeenCalledWith(404);
        });

        it("should throw if invalid hook name", async () => {
             req.params = { name: "invalid" };
             await expect(deleteHook(req as Request, res as Response)).rejects.toThrow("Invalid hook name");
        });

        it("should return 403 when deleting hook in strict mode", async () => {
            req.params = { name: "task_success" };
            vi.mocked(isStrictFeatureDisabled).mockReturnValue(true);

            await deleteHook(req as Request, res as Response);

            expect(status).toHaveBeenCalledWith(403);
            expect(createStrictFeatureDisabledPayload).toHaveBeenCalledWith("hooks");
            expect(deleteHookSpy).not.toHaveBeenCalled();
        });
    });

    describe("getHookStatus", () => {
        it("should return status", async () => {
            const mockStatus = { task_success: true, task_fail: false };
            getHookStatusSpy.mockReturnValue(mockStatus);
            
            await getHookStatus(req as Request, res as Response);
            
            expect(json).toHaveBeenCalledWith(mockStatus);
        });
    });
});
