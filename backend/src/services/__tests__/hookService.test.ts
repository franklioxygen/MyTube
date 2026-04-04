import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureDirSafeSync: vi.fn(),
  execFileSafe: vi.fn(),
  pathExistsSafeSync: vi.fn(),
  resolveSafeChildPath: vi.fn((root: string, child: string) => path.join(root, child)),
  unlinkSafeSync: vi.fn(),
  writeFileSafeSync: vi.fn(),
}));

vi.mock("../../utils/security", () => ({
  ensureDirSafeSync: mocks.ensureDirSafeSync,
  execFileSafe: mocks.execFileSafe,
  pathExistsSafeSync: mocks.pathExistsSafeSync,
  resolveSafeChildPath: mocks.resolveSafeChildPath,
  unlinkSafeSync: mocks.unlinkSafeSync,
  writeFileSafeSync: mocks.writeFileSafeSync,
}));

import { HOOKS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import { HookService } from "../hookService";

vi.mock("../../utils/logger");

describe("HookService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathExistsSafeSync.mockReturnValue(false);
    mocks.execFileSafe.mockResolvedValue({ stdout: "ok", stderr: "" });
  });

  it("should execute configured hook", async () => {
    mocks.pathExistsSafeSync.mockImplementation((filePath: string) => {
      return filePath === path.join(HOOKS_DIR, "task_start.sh");
    });

    await HookService.executeHook("task_start", {
      taskId: "123",
      taskTitle: "Test Task",
      status: "start",
    });

    const expectedPath = path.join(HOOKS_DIR, "task_start.sh");
    expect(mocks.execFileSafe).toHaveBeenCalledTimes(1);
    expect(mocks.execFileSafe).toHaveBeenCalledWith(
      "bash",
      [expectedPath],
      expect.objectContaining({
        env: expect.objectContaining({
          MYTUBE_TASK_ID: "123",
          MYTUBE_TASK_TITLE: "Test Task",
          MYTUBE_TASK_STATUS: "start",
        }),
      }),
    );

    const execOptions = mocks.execFileSafe.mock.calls[0]?.[2];
    expect(execOptions?.timeout).toBeUndefined();
  });

  it("should sanitize multiline hook context values before passing env", async () => {
    mocks.pathExistsSafeSync.mockImplementation((filePath: string) => {
      return filePath === path.join(HOOKS_DIR, "task_start.sh");
    });

    await HookService.executeHook("task_start", {
      taskId: "123",
      taskTitle: "Test\nTask",
      sourceUrl: "https://example.com/watch\nSECOND",
      status: "start",
      error: "first line\r\nsecond line",
    });

    expect(mocks.execFileSafe).toHaveBeenCalledWith(
      "bash",
      [path.join(HOOKS_DIR, "task_start.sh")],
      expect.objectContaining({
        env: expect.objectContaining({
          MYTUBE_TASK_TITLE: "Test Task",
          MYTUBE_SOURCE_URL: "https://example.com/watch SECOND",
          MYTUBE_ERROR: "first line second line",
        }),
      }),
    );
  });

  it("should not execute if hook file does not exist", async () => {
    mocks.pathExistsSafeSync.mockReturnValue(false);

    await HookService.executeHook("task_start", {
      taskId: "123",
      taskTitle: "Test Task",
      status: "start",
    });

    expect(mocks.execFileSafe).not.toHaveBeenCalled();
  });

  it("should handle execution errors gracefully", async () => {
    mocks.pathExistsSafeSync.mockReturnValue(true);
    mocks.execFileSafe.mockRejectedValue(new Error("Command failed"));

    await HookService.executeHook("task_fail", {
      taskId: "123",
      taskTitle: "Test Task",
      status: "fail",
    });

    expect(logger.error).toHaveBeenCalled();
  });
});
