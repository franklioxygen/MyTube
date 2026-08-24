import { spawn } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProviderPluginPath } from "../../services/downloaders/ytdlp/ytdlpHelpers";
import { executeYtDlpJson } from "../../utils/ytdlp/execute";
import { ensureYtDlpAvailable, installYtDlp } from "../../utils/ytdlp/install";
import { getYtDlpStatus, updateYtDlp } from "../../utils/ytdlp/maintenance";
import {
  pipInstallToTarget,
  validateStagedRelease,
} from "../../utils/ytdlp/release/candidate";
import { discoverPythonInterpreter } from "../../utils/ytdlp/release/interpreter";
import { withYtDlpRelease } from "../../utils/ytdlp/release/launcher";
import {
  readCurrentManifest,
  writeCurrentManifest,
  writeReleaseManifest,
} from "../../utils/ytdlp/release/manifests";
import {
  ensureManagedStoreLayout,
  getManagedStoreLayout,
  getSitePackagesPath,
  setManagedStoreRootForTests,
} from "../../utils/ytdlp/release/paths";
import { runProcess } from "../../utils/ytdlp/release/process";
import { isYtDlpImpersonateAvailable } from "../../utils/ytdlp/runtime";
import { resetYtDlpAvailabilityCacheForTests } from "../../utils/ytDlpUtils";
import {
  RELEASE_JSON_FILENAME,
  SITE_PACKAGES_DIRNAME,
  type ReleaseManifest,
} from "../../utils/ytdlp/release/types";

const CANDIDATE_VERSION = "2099.08.19";
const VIDEO_URL = "https://example.com/watch?v=abc";
const MISSAV_URL = "https://missav.example/video";
const NEWER_VERSION = "2099.09.01";

vi.mock("child_process", () => ({ spawn: vi.fn() }));

vi.mock("../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderPluginPath: vi.fn(() => ""),
  getProviderScript: vi.fn(() => ""),
}));

vi.mock("../../utils/ytdlp/release/interpreter", () => ({
  discoverPythonInterpreter: vi.fn(),
}));

vi.mock("../../utils/ytdlp/release/candidate", () => ({
  pipInstallToTarget: vi.fn(),
  validateStagedRelease: vi.fn(),
}));

// Capability probes go through the shared low-level runner, which is stubbed
// so no test needs a real yt-dlp on the machine.
vi.mock("../../utils/ytdlp/release/process", () => ({ runProcess: vi.fn() }));

type MockProcess = EventEmitter & {
  stdout: PassThrough | null;
  stderr: PassThrough | null;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
};

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    return true;
  });
  return proc;
}

/**
 * Each published release records its own interpreter file, so a spawn can be
 * attributed to one specific release. The file must exist on disk: loading a
 * release validates that its interpreter is still there.
 */
let interpreterFor: (version: string) => string = () => "";
let managedInterpreterPrefix = "";

/** Every `spawn` this suite sees is either a discovery probe or a real run. */
function routeSpawn(onCommandRun: (proc: MockProcess) => void) {
  const commandRuns: Array<{ command: string; args: string[] }> = [];
  vi.mocked(spawn).mockImplementation(
    (command: string, args?: readonly string[]) => {
      const list = Array.isArray(args) ? [...args] : [];
      // Nothing usable on PATH: discovery probes always fail with ENOENT.
      if (!command.startsWith(managedInterpreterPrefix)) {
        const proc = createMockProcess();
        queueMicrotask(() =>
          proc.emit(
            "error",
            Object.assign(new Error("not found"), { code: "ENOENT" })
          )
        );
        return proc as never;
      }
      commandRuns.push({ command, args: list });
      const proc = createMockProcess();
      queueMicrotask(() => onCommandRun(proc));
      return proc as never;
    }
  );
  return commandRuns;
}

/**
 * The health probe runs the module-origin script, not `--version`: it has to
 * prove the release runs *and* that it is this release rather than the
 * image-wide install.
 */
const isHealthProbe = (args: readonly string[]) => args[0] === "-c";

function stubCapabilityProbes() {
  vi.mocked(runProcess).mockImplementation(
    async (_command: string, args: readonly string[]) => ({
      code: 0,
      signal: null,
      stdout: isHealthProbe(args)
        ? '{"yt_dlp": "inside"}\n'
        : args.includes("--list-impersonate-targets")
          ? "chrome  curl_cffi\n"
          : "  --js-runtimes RUNTIME\n  --remote-components COMPONENT\n",
      stderr: "",
      timedOut: false,
    })
  );
}

describe("managed release integration", () => {
  let dataRoot: string;
  let storeRoot: string;
  let legacyUserSite: string;
  let publishedVersion = CANDIDATE_VERSION;
  const originalYtDlpPath = process.env.YT_DLP_PATH;
  const originalJsRuntime = process.env.YT_DLP_JS_RUNTIME;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-integration-"));
    storeRoot = path.join(dataRoot, "ytdlp");
    // A Docker-style legacy runtime install that predates the managed store.
    managedInterpreterPrefix = path.join(dataRoot, "managed-python3-");
    interpreterFor = (version: string) => {
      const executable = `${managedInterpreterPrefix}${version}`;
      if (!fs.existsSync(executable)) {
        fs.writeFileSync(executable, "#!/bin/sh\n", { mode: 0o755 });
      }
      return executable;
    };
    legacyUserSite = path.join(dataRoot, ".home", ".local", "lib", "yt_dlp");
    fs.mkdirSync(legacyUserSite, { recursive: true });
    fs.writeFileSync(path.join(legacyUserSite, "__init__.py"), "legacy\n");

    resetYtDlpAvailabilityCacheForTests();
    setManagedStoreRootForTests(storeRoot);
    delete process.env.YT_DLP_PATH;
    process.env.YT_DLP_JS_RUNTIME = "node";
    process.env.HOME = path.join(dataRoot, ".home");
    publishedVersion = CANDIDATE_VERSION;

    vi.mocked(getProviderPluginPath).mockReturnValue("");
    stubCapabilityProbes();
    vi.mocked(discoverPythonInterpreter).mockImplementation(async () => ({
      command: interpreterFor(publishedVersion),
      prefixArgs: [],
      executable: interpreterFor(publishedVersion),
    }));
    vi.mocked(pipInstallToTarget).mockImplementation(
      async (_interpreter, targetDir) => {
        fs.mkdirSync(path.join(targetDir, "yt_dlp"), { recursive: true });
        fs.writeFileSync(path.join(targetDir, "yt_dlp", "__init__.py"), "");
      }
    );
    vi.mocked(validateStagedRelease).mockImplementation(async (input) => {
      const manifest: ReleaseManifest = {
        schemaVersion: 1,
        releaseId: input.createReleaseId(publishedVersion),
        version: publishedVersion,
        installedAt: input.installedAt,
        pythonExecutable: interpreterFor(publishedVersion),
        pythonPrefixArgs: [],
        sitePackages: SITE_PACKAGES_DIRNAME,
      };
      fs.writeFileSync(
        path.join(input.stagingRoot, RELEASE_JSON_FILENAME),
        `${JSON.stringify(manifest, null, 2)}\n`
      );
      return manifest;
    });
  });

  afterEach(() => {
    resetYtDlpAvailabilityCacheForTests();
    setManagedStoreRootForTests(null);
    fs.rmSync(dataRoot, { recursive: true, force: true });
    restoreEnv("YT_DLP_PATH", originalYtDlpPath);
    restoreEnv("YT_DLP_JS_RUNTIME", originalJsRuntime);
    restoreEnv("HOME", originalHome);
  });

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  function snapshotTree(root: string): Record<string, string> {
    const files: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          files[path.relative(root, full)] = fs.readFileSync(full, "utf8");
        }
      }
    };
    walk(root);
    return files;
  }

  it("installs the first managed release when yt-dlp is missing, then executes it", async () => {
    const runs = routeSpawn((proc) => {
      proc.stdout?.emit("data", Buffer.from('{"title":"ok"}'));
      proc.emit("close", 0);
    });

    await expect(
      executeYtDlpJson(VIDEO_URL)
    ).resolves.toEqual({ title: "ok" });

    // A managed release now exists and is what actually ran.
    const current = readCurrentManifest(storeRoot);
    expect(current?.releaseId).toBeTruthy();
    expect(runs).toHaveLength(1);
    expect(runs[0].command).toBe(interpreterFor(CANDIDATE_VERSION));
    expect(runs[0].args.slice(0, 2)).toEqual(["-m", "yt_dlp"]);
    expect(runs[0].args).toContain(VIDEO_URL);
  });

  it("does not accept a release that resolves yt_dlp from the image install", async () => {
    // PYTHONNOUSERSITE only disables the *user* site and the image installs
    // yt-dlp globally, so a `--version` probe would succeed against the
    // image-wide copy while status reported the manifest's version. The health
    // probe therefore checks module origin, not just that something ran.
    routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();
    const shadowed = readCurrentManifest(storeRoot)!.releaseId;

    const probes: string[][] = [];
    vi.mocked(runProcess).mockImplementation(async (_command, args) => {
      if (isHealthProbe(args)) {
        probes.push([...args]);
        // The script exits 2 when yt_dlp resolved outside the target.
        return {
          code: 2,
          signal: null,
          stdout: '{"yt_dlp": "outside"}\n',
          stderr: "",
          timedOut: false,
        };
      }
      return {
        code: 0,
        signal: null,
        stdout: "  --js-runtimes RUNTIME\n",
        stderr: "",
        timedOut: false,
      };
    });
    resetYtDlpAvailabilityCacheForTests();
    setManagedStoreRootForTests(storeRoot);

    const status = await getYtDlpStatus();

    // The probe is handed the release's own site-packages as the allowed root.
    expect(probes.length).toBeGreaterThan(0);
    expect(probes[0].some((arg) => arg.includes(shadowed))).toBe(true);
    // And a release importing from elsewhere is not reported as available.
    expect(status.version).not.toBe(CANDIDATE_VERSION);
  });

  it("reinstalls when a persisted release no longer runs", async () => {
    // A store that outlives an image upgrade can keep a valid interpreter path
    // and a populated site-packages whose dependencies no longer match the new
    // Python. Existence checks alone would keep selecting a release on which
    // every invocation fails.
    routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();
    const broken = readCurrentManifest(storeRoot)!.releaseId;

    // The recorded interpreter still exists but now fails to run yt_dlp.
    const brokenInterpreter = interpreterFor(CANDIDATE_VERSION);
    vi.mocked(runProcess).mockImplementation(
      async (command: string, args: readonly string[]) => {
        // Only the release installed against the old interpreter is broken.
        if (isHealthProbe(args) && command === brokenInterpreter) {
          return {
            code: 1,
            signal: null,
            stdout: "",
            stderr: "No module named yt_dlp",
            timedOut: false,
          };
        }
        return {
          code: 0,
          signal: null,
          stdout: "  --js-runtimes RUNTIME\n",
          stderr: "",
          timedOut: false,
        };
      }
    );
    publishedVersion = NEWER_VERSION;
    resetYtDlpAvailabilityCacheForTests();
    setManagedStoreRootForTests(storeRoot);

    await ensureYtDlpAvailable();

    // A new release was installed rather than the broken one kept.
    const repaired = readCurrentManifest(storeRoot)!.releaseId;
    expect(repaired).not.toBe(broken);

    // And acquisition must not re-select the broken one: an existence check
    // cannot tell it apart from a healthy release.
    const release = await withYtDlpRelease(async (r) => r);
    expect(release.releaseId).toBe(repaired);
  });

  it("does not report a release that cannot run as available", async () => {
    // An operator checking status or pressing Update before any download would
    // otherwise see a broken release reported as healthy, and the update would
    // treat a same-version repair as a redundant no-op.
    routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();
    const broken = readCurrentManifest(storeRoot)!.releaseId;

    const brokenInterpreter = interpreterFor(CANDIDATE_VERSION);
    vi.mocked(runProcess).mockImplementation(async (command, args) => {
      if (isHealthProbe(args) && command === brokenInterpreter) {
        return {
          code: 1,
          signal: null,
          stdout: "",
          stderr: "No module named yt_dlp",
          timedOut: false,
        };
      }
      return {
        code: 0,
        signal: null,
        stdout: "  --js-runtimes RUNTIME\n",
        stderr: "",
        timedOut: false,
      };
    });
    resetYtDlpAvailabilityCacheForTests();
    setManagedStoreRootForTests(storeRoot);

    const status = await getYtDlpStatus();
    expect(status.path).not.toBe(brokenInterpreter);

    // And the operator update repairs it even though pip yields the same
    // version it is replacing.
    const result = await updateYtDlp();
    expect(result.changed).toBe(false);
    expect(readCurrentManifest(storeRoot)!.releaseId).not.toBe(broken);
  });

  it("repairs a current release whose site-packages went missing", async () => {
    // release.json still parses, so the version is known and a same-version
    // candidate would be rejected as already current - leaving the structurally
    // broken pointer in place forever.
    routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();
    const broken = readCurrentManifest(storeRoot)!.releaseId;
    fs.rmSync(
      path.join(
        getManagedStoreLayout(storeRoot).releasesDir,
        broken,
        SITE_PACKAGES_DIRNAME
      ),
      { recursive: true, force: true }
    );

    resetYtDlpAvailabilityCacheForTests();
    setManagedStoreRootForTests(storeRoot);
    stubCapabilityProbes();

    // pip yields the same version it is replacing, which would be rejected as
    // already current if the broken pointer were treated as usable.
    const result = await updateYtDlp();

    expect(result.status.version).toBe(CANDIDATE_VERSION);
    expect(readCurrentManifest(storeRoot)!.releaseId).not.toBe(broken);
    // The replacement is complete, not another pointer at nothing.
    expect(
      fs.existsSync(
        path.join(
          getManagedStoreLayout(storeRoot).releasesDir,
          readCurrentManifest(storeRoot)!.releaseId,
          SITE_PACKAGES_DIRNAME
        )
      )
    ).toBe(true);
  });

  it("validates a release published after availability was already resolved", async () => {
    // Availability is resolved once per process. A second backend sharing the
    // store can publish afterwards, and if it runs a different image or Python
    // ABI its release may be structurally valid here yet unrunnable.
    routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();
    const healthy = readCurrentManifest(storeRoot)!.releaseId;
    await ensureYtDlpAvailable();

    // Another backend publishes; this process never re-resolves availability.
    publishedVersion = NEWER_VERSION;
    await installYtDlp();
    const foreign = readCurrentManifest(storeRoot)!.releaseId;
    expect(foreign).not.toBe(healthy);

    const foreignInterpreter = interpreterFor(NEWER_VERSION);
    vi.mocked(runProcess).mockImplementation(async (command, args) => {
      if (isHealthProbe(args) && command === foreignInterpreter) {
        return {
          code: 1,
          signal: null,
          stdout: "",
          stderr: "No module named yt_dlp",
          timedOut: false,
        };
      }
      return {
        code: 0,
        signal: null,
        stdout: "  --js-runtimes RUNTIME\n",
        stderr: "",
        timedOut: false,
      };
    });

    const release = await withYtDlpRelease(async (r) => r);

    // The newly observed release cannot run here, so the operation must not use
    // it just because current.json points at it.
    expect(release.releaseId).toBe(healthy);
  });

  it("retries a probe that timed out instead of condemning the release", async () => {
    // A timeout or a spawn failure under load says nothing about an immutable
    // release. Caching it as a verdict would strand a healthy current release
    // for the life of the process and force a needless reinstall.
    routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();
    const healthy = readCurrentManifest(storeRoot)!.releaseId;

    let probes = 0;
    vi.mocked(runProcess).mockImplementation(async (_command, args) => {
      if (isHealthProbe(args)) {
        probes += 1;
        if (probes === 1) {
          return {
            code: null,
            signal: null,
            stdout: "",
            stderr: "",
            timedOut: true,
          };
        }
        return {
          code: 0,
          signal: null,
          stdout: `${CANDIDATE_VERSION}\n`,
          stderr: "",
          timedOut: false,
        };
      }
      return {
        code: 0,
        signal: null,
        stdout: "  --js-runtimes RUNTIME\n",
        stderr: "",
        timedOut: false,
      };
    });
    resetYtDlpAvailabilityCacheForTests();
    setManagedStoreRootForTests(storeRoot);

    const first = await withYtDlpRelease(async (r) => r);
    expect(first.releaseId).toBe(healthy);

    // The transient result was not remembered, so the release is probed again
    // rather than skipped.
    const second = await withYtDlpRelease(async (r) => r);
    expect(second.releaseId).toBe(healthy);
    expect(probes).toBeGreaterThan(1);
  });

  it("does not fall back onto a rollback release that also cannot run", async () => {
    // An ABI change breaks every persisted release, not just the current one.
    // Validating only the current one would leave acquisition free to return
    // the rollback on structural checks alone.
    routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();
    const first = readCurrentManifest(storeRoot)!.releaseId;
    publishedVersion = NEWER_VERSION;
    await installYtDlp();
    const second = readCurrentManifest(storeRoot)!.releaseId;
    expect(readCurrentManifest(storeRoot)!.previousReleaseId).toBe(first);

    // Every managed interpreter now fails, and the repair cannot run either.
    vi.mocked(runProcess).mockImplementation(async (command, args) => {
      if (isHealthProbe(args) && command.startsWith(managedInterpreterPrefix)) {
        return {
          code: 1,
          signal: null,
          stdout: "",
          stderr: "No module named yt_dlp",
          timedOut: false,
        };
      }
      return {
        code: 0,
        signal: null,
        stdout: "  --js-runtimes RUNTIME\n",
        stderr: "",
        timedOut: false,
      };
    });
    vi.mocked(pipInstallToTarget).mockRejectedValue(new Error("pip is gone"));

    const emptyBin = path.join(dataRoot, "empty-bin");
    fs.mkdirSync(emptyBin, { recursive: true });
    const previousPath = process.env.PATH;
    process.env.PATH = emptyBin;
    vi.mocked(spawn).mockImplementation(
      (_command: string, args?: readonly string[]) => {
        const proc = createMockProcess();
        const list = Array.isArray(args) ? args : [];
        queueMicrotask(() => {
          if (list.includes("--version")) {
            proc.stdout?.emit("data", Buffer.from("2099.05.05\n"));
          }
          proc.emit("close", 0);
        });
        return proc as never;
      }
    );
    resetYtDlpAvailabilityCacheForTests();
    setManagedStoreRootForTests(storeRoot);

    try {
      const release = await withYtDlpRelease(async (r) => r);
      expect(release.kind).toBe("external");
      expect(release.releaseId).not.toContain(first);
      expect(release.releaseId).not.toContain(second);
    } finally {
      restoreEnv("PATH", previousPath);
    }
  });

  it("falls back to discovery when a broken release cannot be reinstalled", async () => {
    routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();
    const broken = readCurrentManifest(storeRoot)!.releaseId;

    vi.mocked(runProcess).mockImplementation(async (_c, args) => {
      if (isHealthProbe(args)) {
        return {
          code: 1,
          signal: null,
          stdout: "",
          stderr: "No module named yt_dlp",
          timedOut: false,
        };
      }
      return {
        code: 0,
        signal: null,
        stdout: "  --js-runtimes RUNTIME\n",
        stderr: "",
        timedOut: false,
      };
    });
    // The repair cannot succeed either.
    vi.mocked(pipInstallToTarget).mockRejectedValue(new Error("pip is gone"));
    // A working binary is reachable through discovery.
    const previousPath = process.env.PATH;
    process.env.PATH = path.join(dataRoot, "empty-bin");
    fs.mkdirSync(process.env.PATH, { recursive: true });
    vi.mocked(spawn).mockImplementation(
      (_command: string, args?: readonly string[]) => {
        const proc = createMockProcess();
        const list = Array.isArray(args) ? args : [];
        queueMicrotask(() => {
          if (list.includes("--version")) {
            proc.stdout?.emit("data", Buffer.from("2099.05.05\n"));
          }
          proc.emit("close", 0);
        });
        return proc as never;
      }
    );

    resetYtDlpAvailabilityCacheForTests();
    setManagedStoreRootForTests(storeRoot);

    try {
      const release = await withYtDlpRelease(async (r) => r);
      // The known-broken managed release must not come back.
      expect(release.releaseId).not.toContain(broken);
      expect(release.kind).toBe("external");
    } finally {
      restoreEnv("PATH", previousPath);
    }
  });

  it("leaves a legacy user install untouched and out of the managed environment", async () => {
    const legacyBefore = snapshotTree(path.join(dataRoot, ".home"));
    routeSpawn((proc) => {
      proc.stdout?.emit("data", Buffer.from("{}"));
      proc.emit("close", 0);
    });

    let observedEnv: NodeJS.ProcessEnv = {};
    await withYtDlpRelease(async (release) => {
      observedEnv = release.spawnEnv;
    });

    expect(snapshotTree(path.join(dataRoot, ".home"))).toEqual(legacyBefore);
    // PYTHONNOUSERSITE keeps a persistent --user install from contaminating the
    // release, and PYTHONPATH is replaced rather than extended.
    expect(observedEnv.PYTHONNOUSERSITE).toBe("1");
    expect(observedEnv.PYTHONPATH).not.toContain(".local");
    expect(observedEnv.PYTHONPATH).toContain(storeRoot);
  });

  it("publishes an operator update by adding a release and rewriting only current.json", async () => {
    routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();

    const layout = getManagedStoreLayout(storeRoot);
    const before = snapshotTree(layout.releasesDir);
    const firstCurrent = readCurrentManifest(storeRoot);

    publishedVersion = NEWER_VERSION;
    const result = await updateYtDlp();

    expect(result.changed).toBe(true);
    expect(result.previousVersion).toBe(CANDIDATE_VERSION);
    expect(result.status.version).toBe(NEWER_VERSION);
    // For a managed release the reported path is the interpreter MyTube runs.
    expect(result.status.path).toBe(interpreterFor(NEWER_VERSION));
    expect(result.status.updateSupported).toBe(true);

    const after = snapshotTree(layout.releasesDir);
    // Every previously published file is byte-identical; only new files appear.
    for (const [relativePath, contents] of Object.entries(before)) {
      expect(after[relativePath]).toBe(contents);
    }
    expect(Object.keys(after).length).toBeGreaterThan(Object.keys(before).length);

    const secondCurrent = readCurrentManifest(storeRoot);
    expect(secondCurrent?.generation).toBe(firstCurrent!.generation + 1);
    expect(secondCurrent?.previousReleaseId).toBe(firstCurrent!.releaseId);
  });

  it("reports no change when the operator updates an already-current release", async () => {
    routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();
    const firstCurrent = readCurrentManifest(storeRoot);

    // Same version comes back: this is a successful no-op, not a failure.
    const result = await updateYtDlp();

    expect(result.changed).toBe(false);
    expect(result.status.version).toBe(CANDIDATE_VERSION);
    expect(readCurrentManifest(storeRoot)?.generation).toBe(
      firstCurrent!.generation
    );
  });

  it("probes and spawns MissAV-style work against one release", async () => {
    const runs = routeSpawn((proc) => proc.emit("close", 0));
    await installYtDlp();
    const firstRelease = readCurrentManifest(storeRoot)!.releaseId;

    const observed: { probeRelease?: string; spawnRelease?: string } = {};
    await withYtDlpRelease(async (release) => {
      observed.probeRelease = release.releaseId;
      await isYtDlpImpersonateAvailable(release);

      // A newer release is published between the probe and the spawn.
      publishedVersion = NEWER_VERSION;
      await installYtDlp();

      observed.spawnRelease = release.releaseId;
      const { spawnYtDlp } = await import("../../utils/ytdlp/release/launcher");
      const child = spawnYtDlp(release, [MISSAV_URL]);
      await new Promise<void>((resolve) => child.on("close", () => resolve()));
    });

    expect(observed.probeRelease).toBe(firstRelease);
    expect(observed.spawnRelease).toBe(firstRelease);
    // The published release did move on, so this really was a race.
    expect(readCurrentManifest(storeRoot)?.releaseId).not.toBe(firstRelease);
    const missavRun = runs.find((run) =>
      run.args.some((arg) => arg === MISSAV_URL)
    );
    // The probe answered for the first release, so the spawn must use its
    // interpreter, not the one the newer release records.
    expect(missavRun?.command).toBe(interpreterFor(CANDIDATE_VERSION));
  });

  it("keeps a same-operation retry on its snapshot and gives a new call the newer release", async () => {
    await installYtDlp();
    const firstRelease = readCurrentManifest(storeRoot)!.releaseId;

    let attempt = 0;
    const runs = routeSpawn((proc) => {
      attempt += 1;
      if (attempt === 1) {
        // Publish a newer release *between* the two attempts of the same
        // logical operation, then drive the format-restriction retry.
        void (async () => {
          publishedVersion = NEWER_VERSION;
          await installYtDlp();
          proc.stderr?.emit(
            "data",
            Buffer.from("ERROR: Requested format is not available")
          );
          proc.emit("close", 1);
        })();
        return;
      }
      proc.stdout?.emit("data", Buffer.from(`{"attempt":"${attempt}"}`));
      proc.emit("close", 0);
    });

    await expect(
      executeYtDlpJson(VIDEO_URL, { format: "bestvideo" })
    ).resolves.toEqual({ attempt: "2" });

    const jsonRuns = runs.filter((run) =>
      run.args.some((arg) => arg === VIDEO_URL)
    );
    expect(jsonRuns).toHaveLength(2);
    // Both attempts belong to one logical operation, so both must run the
    // release acquired at the start — never the one published in between.
    for (const run of jsonRuns) {
      expect(run.command).toBe(interpreterFor(CANDIDATE_VERSION));
    }

    // The newer release really is current, and the next logical operation and
    // the status endpoint both see it.
    const secondRelease = readCurrentManifest(storeRoot)!.releaseId;
    expect(secondRelease).not.toBe(firstRelease);
    const status = await getYtDlpStatus();
    expect(status.version).toBe(NEWER_VERSION);
    expect(status.path).toBe(interpreterFor(NEWER_VERSION));
  });
  // Design section 10.5 / acceptance criterion 13: upgrading an existing
  // installation must behave exactly like the previous version until a managed
  // release is deliberately published, and a broken store must never stop the
  // backend from serving.
  describe("upgrade compatibility", () => {
    const originalPath = process.env.PATH;

    beforeEach(() => {
      // An empty PATH makes discovery deterministic: it falls through to the
      // default `yt-dlp` name instead of finding whatever this machine has.
      const emptyBin = path.join(dataRoot, "empty-bin");
      fs.mkdirSync(emptyBin, { recursive: true });
      process.env.PATH = emptyBin;
      // A working fallback binary answers the discovery probe.
      vi.mocked(spawn).mockImplementation(
        (command: string, args?: readonly string[]) => {
          const proc = createMockProcess();
          const list = Array.isArray(args) ? args : [];
          queueMicrotask(() => {
            if (list.includes("--version")) {
              proc.stdout?.emit("data", Buffer.from("2099.05.05\n"));
            }
            proc.emit("close", 0);
          });
          return proc as never;
        }
      );
    });

    afterEach(() => {
      restoreEnv("PATH", originalPath);
    });

    it("serves from fallback discovery when no managed store exists", async () => {
      expect(fs.existsSync(storeRoot)).toBe(false);

      const status = await getYtDlpStatus();

      expect(status.available).toBe(true);
      expect(status.version).toBe("2099.05.05");
      expect(status.path).toBe("yt-dlp");
      expect(status.customPathConfigured).toBe(false);
      // The store is created lazily by an install, never eagerly at startup.
      expect(fs.existsSync(storeRoot)).toBe(false);

      const release = await withYtDlpRelease(async (r) => r);
      expect(release.kind).toBe("external");
      // External releases keep the previous version's environment semantics.
      expect(release.spawnEnv.PYTHONNOUSERSITE).toBeUndefined();
    });

    it("serves with a legacy user install present and leaves it untouched", async () => {
      const legacyBefore = snapshotTree(path.join(dataRoot, ".home"));

      const status = await getYtDlpStatus();
      await withYtDlpRelease(async () => undefined);

      expect(status.available).toBe(true);
      expect(snapshotTree(path.join(dataRoot, ".home"))).toEqual(legacyBefore);
      expect(fs.existsSync(storeRoot)).toBe(false);
    });

    it("adopts a managed store left behind by a newer run", async () => {
      // No installer runs here: the store is exactly what a newer version of
      // MyTube would have written.
      const releaseId = "ytdlp-preexisting-7777ffff";
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      fs.mkdirSync(getSitePackagesPath(layout, releaseId), { recursive: true });
      writeReleaseManifest(storeRoot, {
        schemaVersion: 1,
        releaseId,
        version: NEWER_VERSION,
        installedAt: new Date().toISOString(),
        pythonExecutable: interpreterFor(NEWER_VERSION),
        pythonPrefixArgs: [],
        sitePackages: SITE_PACKAGES_DIRNAME,
      });
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 9,
        releaseId,
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      });

      const status = await getYtDlpStatus();
      expect(status.version).toBe(NEWER_VERSION);
      expect(status.path).toBe(interpreterFor(NEWER_VERSION));
      expect(status.updateSupported).toBe(true);

      const release = await withYtDlpRelease(async (r) => r);
      expect(release.kind).toBe("managed");
      expect(release.releaseId).toBe(releaseId);
    });

    it("degrades to fallback discovery when the managed store is unusable", async () => {
      // Unexpected content in data/ytdlp/. A store problem may disable the
      // update feature; it must not prevent serving.
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      fs.rmSync(layout.releasesDir, { recursive: true, force: true });
      fs.writeFileSync(layout.releasesDir, "not a directory");

      const status = await getYtDlpStatus();

      expect(status.available).toBe(true);
      expect(status.path).toBe("yt-dlp");
      await expect(
        withYtDlpRelease(async (r) => r.kind)
      ).resolves.toBe("external");
    });
  });
});
