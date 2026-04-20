import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("VERSION", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reads the backend package version and defaults build date to unknown", async () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
    ) as { version: string };

    const { VERSION } = await import("../version");

    expect(VERSION.number).toBe(packageJson.version);
    expect(VERSION.buildDate).toBe("unknown");
  });

  it("uses MYTUBE_BUILD_DATE when provided", async () => {
    vi.stubEnv("MYTUBE_BUILD_DATE", "2026-04-18T22:25:00Z");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { VERSION } = await import("../version");

    expect(VERSION.buildDate).toBe("2026-04-18T22:25:00Z");
    VERSION.displayVersion();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Build Date: 2026-04-18T22:25:00Z")
    );
  });
});
