import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Define mocks
const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  existsSync: vi.fn(),
  chmodSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  default: {
    exec: mocks.exec,
  },
  exec: mocks.exec,
}));

vi.mock("fs", () => ({
  default: {
    existsSync: mocks.existsSync,
    chmodSync: mocks.chmodSync,
    mkdirSync: mocks.mkdirSync,
  },
  existsSync: mocks.existsSync,
  chmodSync: mocks.chmodSync,
  mkdirSync: mocks.mkdirSync,
}));

import { HOOKS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import { HookService } from "../hookService";

vi.mock("../../utils/logger");

describe("HookService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default exec implementation
    mocks.exec.mockImplementation((cmd: string, options: any, callback: any) => {
        if (callback) {
            callback(null, { stdout: "ok", stderr: "" });
        }
        return { stdout: "ok", stderr: "" };
    });
  });

  it("should execute configured hook", async () => {
    // Mock file existence
    mocks.existsSync.mockImplementation((p: string) => {
        return p === path.join(HOOKS_DIR, "task_start.sh");
    });

    await HookService.executeHook("task_start", {
      taskId: "123",
      taskTitle: "Test Task",
      status: "start",
    });

    const expectedPath = path.join(HOOKS_DIR, "task_start.sh");
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    
    // Check command
    expect(mocks.exec.mock.calls[0][0]).toBe(`bash "${expectedPath}"`);

    // Check env vars
    const env = mocks.exec.mock.calls[0][1]?.env;
    expect(env).toBeDefined();
    expect(env?.MYTUBE_TASK_ID).toBe("123");
    expect(env?.MYTUBE_TASK_TITLE).toBe("Test Task");
    expect(env?.MYTUBE_TASK_STATUS).toBe("start");
  });

  it("should not execute if hook file does not exist", async () => {
    mocks.existsSync.mockReturnValue(false);

    await HookService.executeHook("task_start", {
      taskId: "123",
      taskTitle: "Test Task",
      status: "start",
    });

    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("should handle execution errors gracefully", async () => {
    mocks.existsSync.mockReturnValue(true);

    mocks.exec.mockImplementation((cmd: string, options: any, callback: any) => {
         throw new Error("Command failed");
    });

    // Should not throw
    await HookService.executeHook("task_fail", {
      taskId: "123",
      taskTitle: "Test Task",
      status: "fail",
    });

    expect(logger.error).toHaveBeenCalled();
  });
});
