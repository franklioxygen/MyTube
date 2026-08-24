import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProviderPluginPath } from "../../services/downloaders/ytdlp/ytdlpHelpers";
import { validateStagedRelease } from "../../utils/ytdlp/release/candidate";
import { MODULE_ORIGIN_SCRIPT } from "../../utils/ytdlp/release/moduleOrigin";
import { runProcess } from "../../utils/ytdlp/release/process";
import { RELEASE_JSON_FILENAME } from "../../utils/ytdlp/release/types";

vi.mock("../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderPluginPath: vi.fn(() => ""),
  getProviderScript: vi.fn(() => ""),
}));

vi.mock("../../utils/ytdlp/release/process", () => ({
  runProcess: vi.fn(),
}));

const PYTHON = findPython();

function findPython(): string | null {
  for (const candidate of ["python3", "python"]) {
    const probe = spawnSync(candidate, ["-c", "print(1)"], {
      stdio: "ignore",
      shell: false,
    });
    if (probe.status === 0) {
      return candidate;
    }
  }
  return null;
}

type ProbeResult = {
  code: number | null;
  signal: null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const ok = (stdout = ""): ProbeResult => ({
  code: 0,
  signal: null,
  stdout,
  stderr: "",
  timedOut: false,
});

describe("candidate validation", () => {
  let stagingRoot: string;
  let sitePackagesPath: string;

  beforeEach(() => {
    stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-staging-"));
    sitePackagesPath = path.join(stagingRoot, "site-packages");
    fs.mkdirSync(sitePackagesPath, { recursive: true });
    vi.mocked(getProviderPluginPath).mockReturnValue("");
  });

  afterEach(() => {
    vi.mocked(runProcess).mockReset();
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  });

  function validate() {
    return validateStagedRelease({
      interpreter: {
        command: "/usr/bin/python3",
        prefixArgs: [],
        executable: "/usr/bin/python3",
      },
      stagingRoot,
      sitePackagesPath,
      createReleaseId: (version) => `ytdlp-${version.replace(/\./g, "")}-abcd1234`,
      installedAt: new Date().toISOString(),
    });
  }

  /** Route each probe by the flag it carries, so order is not assumed. */
  function stubProbes(overrides: Record<string, ProbeResult> = {}) {
    vi.mocked(runProcess).mockImplementation(
      async (_command: string, args: readonly string[]) => {
        if (args.includes("--version")) {
          return overrides.version ?? ok("2026.08.19\n");
        }
        if (args.includes("--help")) {
          return overrides.help ?? ok("  --js-runtimes RUNTIME\n");
        }
        if (args.includes("--list-impersonate-targets")) {
          return overrides.impersonate ?? ok("chrome  curl_cffi\n");
        }
        // Anything else is the `python -c` module-origin probe.
        return overrides.origin ?? ok('{"yt_dlp": true}\n');
      }
    );
  }

  it("writes release.json only after every probe passes", async () => {
    stubProbes();
    const manifest = await validate();

    expect(manifest.version).toBe("2026.08.19");
    expect(manifest.releaseId).toBe("ytdlp-20260819-abcd1234");
    const written = JSON.parse(
      fs.readFileSync(path.join(stagingRoot, RELEASE_JSON_FILENAME), "utf8")
    );
    expect(written.releaseId).toBe(manifest.releaseId);
  });

  it("rejects a candidate whose modules resolve outside the managed site-packages", async () => {
    // The origin probe exits 2 when `yt_dlp.__file__` is not inside the target.
    stubProbes({
      origin: {
        code: 2,
        signal: null,
        stdout: '{"yt_dlp": false}\n',
        stderr: "",
        timedOut: false,
      },
    });

    await expect(validate()).rejects.toThrow(/outside the managed site-packages/);
    // Nothing may be published from a rejected candidate.
    expect(fs.existsSync(path.join(stagingRoot, RELEASE_JSON_FILENAME))).toBe(
      false
    );
  });

  it("rejects a candidate that cannot report a version or complete --help", async () => {
    stubProbes({
      version: { code: 1, signal: null, stdout: "", stderr: "boom", timedOut: false },
    });
    await expect(validate()).rejects.toThrow(/--version probe failed/);

    stubProbes({
      help: { code: null, signal: null, stdout: "", stderr: "", timedOut: true },
    });
    await expect(validate()).rejects.toThrow(/--help probe failed/);
  });

  it("treats an unavailable impersonation target as a capability, not a failure", async () => {
    // Design section 8.3: absence of an available target is recorded as a
    // capability. Only a probe that never completes fails the candidate.
    stubProbes({
      impersonate: {
        code: 0,
        signal: null,
        stdout: "chrome  (unavailable)\n",
        stderr: "",
        timedOut: false,
      },
    });
    await expect(validate()).resolves.toMatchObject({ version: "2026.08.19" });

    stubProbes({
      impersonate: {
        code: null,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: true,
      },
    });
    await expect(validate()).rejects.toThrow(/impersonation probe timed out/);
  });

  // The probe above asserts the wiring. This one runs the actual script the
  // installer ships, so a change to it that stops detecting an ambient install
  // is caught too.
  describe.skipIf(!PYTHON)("module-origin script against a real interpreter", () => {
    function runOriginScript(pythonPath: string[], target: string) {
      return spawnSync(PYTHON as string, ["-c", MODULE_ORIGIN_SCRIPT, target], {
        env: {
          ...process.env,
          PYTHONPATH: pythonPath.join(path.delimiter),
          PYTHONNOUSERSITE: "1",
        },
        encoding: "utf8",
        shell: false,
      });
    }

    function writeFakeModule(dir: string): void {
      const moduleDir = path.join(dir, "yt_dlp");
      fs.mkdirSync(moduleDir, { recursive: true });
      fs.writeFileSync(path.join(moduleDir, "__init__.py"), "__version__ = '0'\n");
    }

    it("accepts an import that resolves inside the target", () => {
      writeFakeModule(sitePackagesPath);
      const result = runOriginScript([sitePackagesPath], sitePackagesPath);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).yt_dlp).toBe("inside");
    });

    it("rejects an optional module that resolves outside the target", () => {
      // curl_cffi missing entirely is fine — impersonation is simply
      // unavailable. curl_cffi resolving from a system install is not: the
      // release would run against a mutable ambient dependency.
      const ambient = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-ambient-"));
      try {
        writeFakeModule(sitePackagesPath);
        const moduleDir = path.join(ambient, "curl_cffi");
        fs.mkdirSync(moduleDir, { recursive: true });
        fs.writeFileSync(path.join(moduleDir, "__init__.py"), "");

        const result = runOriginScript(
          [sitePackagesPath, ambient],
          sitePackagesPath
        );

        expect(JSON.parse(result.stdout)).toMatchObject({
          yt_dlp: "inside",
          curl_cffi: "outside",
        });
        expect(result.status).toBe(2);
      } finally {
        fs.rmSync(ambient, { recursive: true, force: true });
      }
    });

    it("accepts a candidate whose optional modules are simply absent", () => {
      writeFakeModule(sitePackagesPath);
      const result = runOriginScript([sitePackagesPath], sitePackagesPath);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        yt_dlp: "inside",
        curl_cffi: "absent",
      });
    });

    it("rejects an import shadowed by an ambient install", () => {
      // The target is empty; yt_dlp resolves from an unrelated directory, which
      // is exactly the silent version-mixing this check exists to prevent.
      const ambient = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-ambient-"));
      try {
        writeFakeModule(ambient);
        const result = runOriginScript(
          [sitePackagesPath, ambient],
          sitePackagesPath
        );
        expect(result.status).toBe(2);
        expect(JSON.parse(result.stdout).yt_dlp).toBe("outside");
      } finally {
        fs.rmSync(ambient, { recursive: true, force: true });
      }
    });
  });
});
