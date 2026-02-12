/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { cloudflaredService } from "../../services/cloudflaredService";

type MockChild = {
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
};

describe("cloudflaredService extra coverage", () => {
  let mockProcess: MockChild;
  let stdoutDataHandler: ((data: Buffer) => void) | undefined;
  let stderrDataHandler: ((data: Buffer) => void) | undefined;
  let closeHandler: ((code: number | null) => void) | undefined;
  let errorHandler: ((err: NodeJS.ErrnoException) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    stdoutDataHandler = undefined;
    stderrDataHandler = undefined;
    closeHandler = undefined;
    errorHandler = undefined;

    mockProcess = {
      stdout: {
        on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === "data") stdoutDataHandler = cb;
        }),
      },
      stderr: {
        on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === "data") stderrDataHandler = cb;
        }),
      },
      on: vi.fn((event: string, cb: any) => {
        if (event === "close") closeHandler = cb;
        if (event === "error") errorHandler = cb;
      }),
      kill: vi.fn(),
    };

    vi.mocked(spawn).mockReturnValue(mockProcess as any);
    vi.mocked(fs.existsSync).mockImplementation(
      (p: fs.PathLike) => String(p) === "/opt/homebrew/bin/cloudflared"
    );
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found in PATH");
    });
    cloudflaredService.stop();
  });

  afterEach(() => {
    cloudflaredService.stop();
  });

  it("handles invalid base64 token parsing but still starts named tunnel", () => {
    cloudflaredService.start("not-base64-token");

    expect(spawn).toHaveBeenCalledWith("/opt/homebrew/bin/cloudflared", [
      "tunnel",
      "run",
      "--token",
      "not-base64-token",
    ]);
    expect(cloudflaredService.getStatus().tunnelId).toBeNull();
    expect(cloudflaredService.getStatus().accountTag).toBeNull();
  });

  it("captures quick tunnel public URL from process output", () => {
    cloudflaredService.start(undefined, 5551);

    stdoutDataHandler?.(
      Buffer.from("INF |  https://abc-xyz.trycloudflare.com  | tunnel ready")
    );
    expect(cloudflaredService.getStatus().publicUrl).toBe(
      "https://abc-xyz.trycloudflare.com"
    );

    stderrDataHandler?.(
      Buffer.from("INF |  https://stderr-url.trycloudflare.com  | tunnel ready")
    );
    expect(cloudflaredService.getStatus().publicUrl).toBe(
      "https://stderr-url.trycloudflare.com"
    );
  });

  it("updates status when process closes", () => {
    cloudflaredService.start();
    expect(cloudflaredService.getStatus().isRunning).toBe(true);

    closeHandler?.(0);

    expect(cloudflaredService.getStatus().isRunning).toBe(false);
    expect(cloudflaredService.getStatus().publicUrl).toBeNull();
  });

  it("handles ENOENT process error on linux and resets status", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    cloudflaredService.start();
    errorHandler?.({ code: "ENOENT" } as NodeJS.ErrnoException);

    expect(cloudflaredService.getStatus().isRunning).toBe(false);
    expect(cloudflaredService.getStatus().publicUrl).toBeNull();

    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("handles ENOENT process error on windows path guidance branch", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    cloudflaredService.start();
    errorHandler?.({ code: "ENOENT" } as NodeJS.ErrnoException);

    expect(cloudflaredService.getStatus().isRunning).toBe(false);

    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("handles non-ENOENT process errors and resets state", () => {
    cloudflaredService.start();
    errorHandler?.({ code: "EACCES", message: "permission denied" } as any);

    expect(cloudflaredService.getStatus().isRunning).toBe(false);
    expect(cloudflaredService.getStatus().publicUrl).toBeNull();
  });

  it("handles spawn-time exceptions", () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error("spawn exploded");
    });

    cloudflaredService.start();

    expect(cloudflaredService.getStatus().isRunning).toBe(false);
    expect(cloudflaredService.getStatus().publicUrl).toBeNull();
  });

  it("returns early with platform-specific missing executable guidance (linux/windows)", () => {
    const originalPlatform = process.platform;

    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found");
    });
    cloudflaredService.start();
    expect(spawn).not.toHaveBeenCalled();

    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    cloudflaredService.start();
    expect(spawn).not.toHaveBeenCalled();

    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("restart stops then starts service with delayed callback", () => {
    const startSpy = vi.spyOn(cloudflaredService, "start");
    const stopSpy = vi.spyOn(cloudflaredService, "stop");
    const timeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((fn: any) => {
        if (typeof fn === "function") fn();
        return 0 as any;
      }) as any);

    cloudflaredService.restart("token-123", 8088);

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith("token-123", 8088);

    timeoutSpy.mockRestore();
    startSpy.mockRestore();
    stopSpy.mockRestore();
  });
});
