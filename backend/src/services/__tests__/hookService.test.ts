import { EventEmitter } from "events";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  httpRequest: vi.fn(),
  httpsRequest: vi.fn(),
  enqueueHookWorkerJob: vi.fn(() => "job-test-id"),
  recordSecurityAuditEvent: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: mocks.existsSync,
    mkdirSync: mocks.mkdirSync,
    unlinkSync: mocks.unlinkSync,
    readFileSync: mocks.readFileSync,
    writeFileSync: mocks.writeFileSync,
  },
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  unlinkSync: mocks.unlinkSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
}));

vi.mock("http", () => ({
  default: { request: mocks.httpRequest },
  request: mocks.httpRequest,
}));

vi.mock("https", () => ({
  default: { request: mocks.httpsRequest },
  request: mocks.httpsRequest,
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../utils/strictSecurity", () => ({
  isStrictFeatureDisabled: vi.fn(() => false),
}));

vi.mock("../hookWorkerQueueService", () => ({
  enqueueHookWorkerJob: mocks.enqueueHookWorkerJob,
}));

vi.mock("../securityAuditService", () => ({
  recordSecurityAuditEvent: mocks.recordSecurityAuditEvent,
}));

import { HOOKS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import { isStrictFeatureDisabled } from "../../utils/strictSecurity";
import { HookService } from "../hookService";

const createSuccessfulRequestMock = (requestMock: ReturnType<typeof vi.fn>) => {
  requestMock.mockImplementation((options: any, callback: any) => {
    const request = new EventEmitter() as any;
    const response = new EventEmitter() as any;
    response.statusCode = 200;

    request.write = vi.fn();
    request.setTimeout = vi.fn();
    request.destroy = vi.fn((error?: Error) => {
      if (error) {
        request.emit("error", error);
      }
    });
    request.end = vi.fn(() => {
      callback(response);
      response.emit("data", Buffer.from("ok"));
      response.emit("end");
    });

    return request;
  });
};

describe("HookService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HOOK_EXECUTION_MODE;
    vi.mocked(isStrictFeatureDisabled).mockReturnValue(false);
    createSuccessfulRequestMock(mocks.httpRequest);
    createSuccessfulRequestMock(mocks.httpsRequest);
    mocks.existsSync.mockReturnValue(false);
  });

  it("uploads normalized declarative hook config", () => {
    mocks.existsSync.mockReturnValue(false);
    const payload = Buffer.from(
      JSON.stringify({
        actions: [
          {
            type: "notify_webhook",
            url: "https://example.com/hook",
            method: "POST",
            timeoutMs: 5000,
          },
        ],
      })
    );

    HookService.uploadHook("task_success", payload);

    const expectedPath = path.join(HOOKS_DIR, "task_success.json");
    expect(mocks.writeFileSync).toHaveBeenCalledTimes(1);
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      expectedPath,
      expect.any(Buffer)
    );
    const writtenBuffer = mocks.writeFileSync.mock.calls[0][1] as Buffer;
    const written = JSON.parse(writtenBuffer.toString("utf-8"));
    expect(written.version).toBe(1);
    expect(written.actions[0].type).toBe("notify_webhook");
  });

  it("rejects forbidden webhook headers during upload", () => {
    const payload = Buffer.from(
      JSON.stringify({
        actions: [
          {
            type: "notify_webhook",
            url: "https://example.com/hook",
            headers: {
              "Content-Length": "12",
            },
          },
        ],
      })
    );

    expect(() => HookService.uploadHook("task_success", payload)).toThrow(
      "Forbidden webhook header: Content-Length"
    );
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("executes configured webhook action", async () => {
    mocks.existsSync.mockImplementation((target: string) =>
      String(target).endsWith("task_success.json")
    );
    mocks.readFileSync.mockReturnValue(
      Buffer.from(
        JSON.stringify({
          actions: [
            {
              type: "notify_webhook",
              url: "http://example.com/hook",
              method: "POST",
              bodyTemplate: "Task {{taskId}} status {{status}}",
            },
          ],
        })
      )
    );

    await HookService.executeHook("task_success", {
      taskId: "123",
      taskTitle: "Title",
      status: "success",
    });

    expect(mocks.httpRequest).toHaveBeenCalledTimes(1);
    const requestOptions = mocks.httpRequest.mock.calls[0][0];
    expect(requestOptions.method).toBe("POST");
    const requestInstance = mocks.httpRequest.mock.results[0].value as any;
    expect(requestInstance.write).toHaveBeenCalledWith("Task 123 status success");
  });

  it("skips execution when no declarative hook config exists", async () => {
    mocks.existsSync.mockReturnValue(false);

    await HookService.executeHook("task_success", {
      taskId: "123",
      taskTitle: "Title",
      status: "success",
    });

    expect(mocks.httpRequest).not.toHaveBeenCalled();
    expect(mocks.httpsRequest).not.toHaveBeenCalled();
  });

  it("enqueues hook execution to worker queue when worker mode is enabled", async () => {
    process.env.HOOK_EXECUTION_MODE = "worker";
    mocks.existsSync.mockImplementation((target: string) =>
      String(target).endsWith("task_success.json")
    );
    mocks.readFileSync.mockReturnValue(
      Buffer.from(
        JSON.stringify({
          actions: [
            {
              type: "notify_webhook",
              url: "http://example.com/hook",
              method: "POST",
            },
          ],
        })
      )
    );

    await HookService.executeHook("task_success", {
      taskId: "123",
      taskTitle: "Title",
      status: "success",
    });

    expect(mocks.enqueueHookWorkerJob).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHookWorkerJob).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "task_success",
        context: {
          taskId: "123",
          taskTitle: "Title",
          status: "success",
        },
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Enqueued declarative hook task_success")
    );
    expect(mocks.httpRequest).not.toHaveBeenCalled();
    expect(mocks.httpsRequest).not.toHaveBeenCalled();
  });

  it("warns and ignores legacy shell hooks", async () => {
    mocks.existsSync.mockImplementation((target: string) =>
      String(target).endsWith("task_fail.sh")
    );

    await HookService.executeHook("task_fail", {
      taskId: "1",
      taskTitle: "Legacy",
      status: "fail",
    });
    await HookService.executeHook("task_fail", {
      taskId: "2",
      taskTitle: "Legacy 2",
      status: "fail",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Legacy shell hook detected")
    );
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(mocks.recordSecurityAuditEvent).toHaveBeenCalledTimes(2);
    expect(mocks.recordSecurityAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "config.legacy_hook_ignored",
        result: "rejected",
        target: "task_fail",
      })
    );
    expect(mocks.httpRequest).not.toHaveBeenCalled();
  });

  it("skips hook execution when strict feature toggle is enabled", async () => {
    vi.mocked(isStrictFeatureDisabled).mockReturnValue(true);
    mocks.existsSync.mockReturnValue(true);

    await HookService.executeHook("task_success", {
      taskId: "123",
      taskTitle: "Disabled",
      status: "success",
    });

    expect(mocks.httpRequest).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("feature disabled in strict security model")
    );
  });

  it("disableAllHooks deletes declarative and legacy hook files", () => {
    mocks.existsSync.mockImplementation((target: string) => {
      const value = String(target);
      return value.endsWith("task_success.json") || value.endsWith("task_fail.sh");
    });

    const deletedCount = HookService.disableAllHooks();

    expect(deletedCount).toBe(2);
    expect(mocks.unlinkSync).toHaveBeenCalledTimes(2);
  });
});
