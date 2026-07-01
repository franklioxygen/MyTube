import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { awaitTaskCancellationHook, awaitTaskFailHook } from "../../../services/downloadManager/hooks";
import { HookService } from "../../../services/hookService";

vi.mock("../../../services/hookService", () => ({
  HookService: {
    executeHook: vi.fn(),
  },
}));

describe("downloadManager hooks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("awaitTaskFailHook", () => {
    it("awaits the task_fail hook when it resolves", async () => {
      vi.mocked(HookService.executeHook).mockResolvedValue(undefined);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await awaitTaskFailHook({ taskId: "t1", status: "fail" });

      expect(HookService.executeHook).toHaveBeenCalledWith("task_fail", {
        taskId: "t1",
        status: "fail",
      });
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("warns and continues after the 5000ms timeout", async () => {
      // Never resolves -> the timeout branch must fire
      vi.mocked(HookService.executeHook).mockReturnValue(new Promise(() => {}));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const promise = awaitTaskFailHook({ taskId: "t2", status: "fail" });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(warnSpy).toHaveBeenCalledWith(
        "task_fail hook exceeded 5000ms; continuing task failure handling."
      );
    });

    it("swallows a rejected hook and logs an error (never throws)", async () => {
      vi.mocked(HookService.executeHook).mockRejectedValue(new Error("boom"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(awaitTaskFailHook({ taskId: "t3", status: "fail" })).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith("task_fail hook failed:", expect.any(Error));
    });
  });

  describe("awaitTaskCancellationHook", () => {
    it("awaits the provided cancel function when it resolves quickly", async () => {
      const cancelFn = vi.fn().mockResolvedValue(undefined);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await awaitTaskCancellationHook("task-id", cancelFn);

      expect(cancelFn).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("finalizes anyway after the 5000ms timeout when cancel never resolves", async () => {
      const cancelFn = vi.fn().mockReturnValue(new Promise(() => {}));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const promise = awaitTaskCancellationHook("task-id", cancelFn);
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(warnSpy).toHaveBeenCalledWith(
        "Cancel hook for download task-id exceeded 5000ms; finalizing cancellation anyway."
      );
    });
  });
});
