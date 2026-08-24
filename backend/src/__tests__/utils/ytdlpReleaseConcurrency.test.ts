import fs from "fs";
import fsExtra from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProviderPluginPath } from "../../services/downloaders/ytdlp/ytdlpHelpers";
import { YT_DLP_GC_MIN_INTERVAL_MS } from "../../utils/ytdlp/constants";
import { acquireYtDlpRelease } from "../../utils/ytdlp/release/acquire";
import {
  collectGarbage,
  resetCollectionThrottleForTests,
} from "../../utils/ytdlp/release/gc";
import {
  acquireLease,
  beginGcMarker,
  hasLeases,
  listLeaseFilenames,
} from "../../utils/ytdlp/release/leases";
import { withYtDlpRelease } from "../../utils/ytdlp/release/launcher";
import {
  readCurrentManifest,
  writeCurrentManifest,
  writeReleaseManifest,
} from "../../utils/ytdlp/release/manifests";
import {
  ensureManagedStoreLayout,
  getManagedStoreLayout,
  getReleaseDir,
  getSitePackagesPath,
  setManagedStoreRootForTests,
} from "../../utils/ytdlp/release/paths";
import { publishValidatedRelease } from "../../utils/ytdlp/release/publish";
import { resetCapabilityCacheForTests } from "../../utils/ytdlp/release/capabilities";
import { SITE_PACKAGES_DIRNAME } from "../../utils/ytdlp/release/types";
import { resetYtDlpAvailablePromise } from "../../utils/ytdlp/install";
import { appendYouTubeJsRuntimeArg, resetRuntimeCaches } from "../../utils/ytdlp/runtime";

// Stable ids so the hoisted runProcess mock can tell the two releases apart by
// the site-packages path in the spawn environment alone.
const LEGACY_ID = "ytdlp-legacy-aaaa1111";
const MODERN_ID = "ytdlp-modern-bbbb2222";

vi.mock("../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderPluginPath: vi.fn(() => "/app/bgutil-ytdlp-pot-provider"),
  getProviderScript: vi.fn(() => ""),
}));

// Capability probes answer according to whichever release's environment they
// are handed, which is what makes "A's capabilities with B's executable"
// detectable at all.
vi.mock("../../utils/ytdlp/release/process", () => ({
  runProcess: vi.fn(
    async (
      _command: string,
      args: readonly string[],
      options: { env?: NodeJS.ProcessEnv }
    ) => {
      const pythonPath = String(options?.env?.PYTHONPATH ?? "");
      const isLegacy = pythonPath.includes("ytdlp-legacy");
      const ok = (stdout: string) => ({
        code: 0,
        signal: null,
        stdout,
        stderr: "",
        timedOut: false,
      });
      if (args.includes("--help")) {
        return ok(
          isLegacy
            ? "    --js-runtime RUNTIME[:PATH]\n"
            : "    --js-runtimes RUNTIME[:PATH]\n    --remote-components COMPONENT\n"
        );
      }
      if (args.includes("--list-impersonate-targets")) {
        return ok(isLegacy ? "chrome  (unavailable)\n" : "chrome  curl_cffi\n");
      }
      return ok("");
    }
  ),
}));

type Seeded = { releaseId: string; version: string; sitePackagesPath: string };

function seed(
  root: string,
  releaseId: string,
  version: string,
  installedAt = new Date().toISOString()
): Seeded {
  const layout = ensureManagedStoreLayout(getManagedStoreLayout(root));
  const sitePackagesPath = getSitePackagesPath(layout, releaseId);
  fs.mkdirSync(sitePackagesPath, { recursive: true });
  writeReleaseManifest(root, {
    schemaVersion: 1,
    releaseId,
    version,
    installedAt,
    // Never actually spawned: runProcess is mocked and the tests assert on the
    // snapshot rather than on child output.
    pythonExecutable: process.execPath,
    pythonPrefixArgs: [],
    sitePackages: SITE_PACKAGES_DIRNAME,
  });
  return { releaseId, version, sitePackagesPath };
}

function publish(
  root: string,
  releaseId: string,
  generation: number,
  previousReleaseId: string | null = null
): void {
  writeCurrentManifest(root, {
    schemaVersion: 1,
    generation,
    releaseId,
    previousReleaseId,
    publishedAt: new Date().toISOString(),
  });
}

/** A promise the test opens and closes by hand, to pause a task mid-flight. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

function backdate(root: string, releaseId: string): void {
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  fs.utimesSync(getReleaseDir(getManagedStoreLayout(root), releaseId), old, old);
}

describe("yt-dlp release concurrency", () => {
  let storeRoot: string;
  const originalYtDlpPath = process.env.YT_DLP_PATH;
  const originalJsRuntime = process.env.YT_DLP_JS_RUNTIME;

  beforeEach(() => {
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-concurrency-"));
    setManagedStoreRootForTests(storeRoot);
    delete process.env.YT_DLP_PATH;
    // Pins the JS runtime so no probe spawns a real `deno`.
    process.env.YT_DLP_JS_RUNTIME = "node";
    vi.mocked(getProviderPluginPath).mockReturnValue(
      "/app/bgutil-ytdlp-pot-provider"
    );
    resetYtDlpAvailablePromise();
    resetCapabilityCacheForTests();
    resetRuntimeCaches();
    resetCollectionThrottleForTests();
  });

  afterEach(() => {
    resetYtDlpAvailablePromise();
    resetCapabilityCacheForTests();
    resetRuntimeCaches();
    setManagedStoreRootForTests(null);
    fs.rmSync(storeRoot, { recursive: true, force: true });
    if (originalYtDlpPath === undefined) {
      delete process.env.YT_DLP_PATH;
    } else {
      process.env.YT_DLP_PATH = originalYtDlpPath;
    }
    if (originalJsRuntime === undefined) {
      delete process.env.YT_DLP_JS_RUNTIME;
    } else {
      process.env.YT_DLP_JS_RUNTIME = originalJsRuntime;
    }
  });

  it("keeps a paused task on its snapshot when a newer release is published", async () => {
    // Acceptance criteria #2 and #3: a task suspended between capability
    // resolution and spawn cannot end up combining A's capabilities with B's
    // executable, nor the other way round.
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    publish(storeRoot, legacy.releaseId, 1);

    const acquired = gate();
    const paused = gate();
    const observed: {
      before?: string;
      after?: string;
      pythonPath?: string;
      args?: string[];
    } = {};

    const task = withYtDlpRelease(async (release) => {
      observed.before = release.releaseId;
      acquired.open();
      await paused.wait;
      observed.after = release.releaseId;
      observed.pythonPath = release.spawnEnv.PYTHONPATH;
      const args: string[] = [];
      await appendYouTubeJsRuntimeArg(
        args,
        "https://www.youtube.com/watch?v=abc",
        release
      );
      observed.args = args;
    });

    // Publish B only once the task is provably parked on A.
    await acquired.wait;
    const modern = seed(storeRoot, MODERN_ID, "2099.06.01");
    publish(storeRoot, modern.releaseId, 2, legacy.releaseId);

    // A fresh acquisition must already see B — otherwise this test would prove
    // nothing about the paused task.
    const fresh = await acquireYtDlpRelease();
    expect(fresh.releaseId).toBe(MODERN_ID);

    paused.open();
    await task;

    expect(observed.before).toBe(LEGACY_ID);
    expect(observed.after).toBe(LEGACY_ID);
    expect(observed.pythonPath).toContain(legacy.sitePackagesPath);
    expect(observed.pythonPath).not.toContain(modern.sitePackagesPath);
    // A's help text only offers the singular flag; B's offers the plural one.
    expect(observed.args).toEqual(["--js-runtime", "node"]);
  });

  it("protects a leased release from collection across a publication", async () => {
    // Acceptance criterion #7: a running child's release cannot be collected.
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    // Enough newer releases that A falls outside the rollback window, so only
    // the lease can save it.
    seed(storeRoot, "ytdlp-filler-1111cccc", "2099.04.01");
    seed(storeRoot, "ytdlp-filler-2222dddd", "2099.05.01");
    const modern = seed(storeRoot, MODERN_ID, "2099.06.01");
    for (const id of [
      LEGACY_ID,
      "ytdlp-filler-1111cccc",
      "ytdlp-filler-2222dddd",
      MODERN_ID,
    ]) {
      backdate(storeRoot, id);
    }
    publish(storeRoot, legacy.releaseId, 1);

    const acquired = gate();
    const paused = gate();
    let leasedDuringTask = false;
    let observedReleaseId = "";

    const task = withYtDlpRelease(async (release) => {
      observedReleaseId = release.releaseId;
      leasedDuringTask = hasLeases(LEGACY_ID);
      acquired.open();
      await paused.wait;
      // The release directory must still be intact after GC ran underneath.
      expect(
        fs.existsSync(getReleaseDir(getManagedStoreLayout(storeRoot), LEGACY_ID))
      ).toBe(true);
    });

    // Publish B with an unrelated previous pointer, then collect.
    await acquired.wait;
    publish(storeRoot, modern.releaseId, 2, "ytdlp-filler-2222dddd");
    await collectGarbage();

    paused.open();
    await task;

    expect(observedReleaseId).toBe(LEGACY_ID);
    expect(leasedDuringTask).toBe(true);
    // Once the operation finishes the lease is gone and the release becomes
    // collectable.
    expect(hasLeases(LEGACY_ID)).toBe(false);
    await collectGarbage();
    expect(
      fs.existsSync(getReleaseDir(getManagedStoreLayout(storeRoot), LEGACY_ID))
    ).toBe(false);
  });

  it("collects a release once the lease pinning it is released", async () => {
    // Collection is skipped while a download holds the release. Nothing else
    // would revisit it until the next install, which may be months away, so
    // releasing the lease offers a (throttled) collection.
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    seed(storeRoot, "ytdlp-filler-1111cccc", "2099.04.01");
    seed(storeRoot, "ytdlp-filler-2222dddd", "2099.05.01");
    const modern = seed(storeRoot, MODERN_ID, "2099.06.01");
    for (const id of [
      LEGACY_ID,
      "ytdlp-filler-1111cccc",
      "ytdlp-filler-2222dddd",
      MODERN_ID,
    ]) {
      backdate(storeRoot, id);
    }
    publish(storeRoot, legacy.releaseId, 1);

    const layout = getManagedStoreLayout(storeRoot);
    await withYtDlpRelease(async (release) => {
      expect(release.releaseId).toBe(LEGACY_ID);
      publish(storeRoot, modern.releaseId, 2, "ytdlp-filler-2222dddd");
      // No explicit collection here: running one would arm the throttle and
      // mask whether releasing the lease offers its own.
      expect(fs.existsSync(getReleaseDir(layout, LEGACY_ID))).toBe(true);
    });

    // The scope has exited: the lease is gone and collection was offered.
    await vi.waitFor(() => {
      expect(fs.existsSync(getReleaseDir(layout, LEGACY_ID))).toBe(false);
    });
  });

  it("defers, rather than drops, a collection suppressed by the throttle", async () => {
    // Publication runs its own collection, which arms the throttle. The
    // follow-up that actually matters - the one after the last lease goes away
    // - would then be the one discarded.
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    seed(storeRoot, "ytdlp-filler-1111cccc", "2099.04.01");
    seed(storeRoot, "ytdlp-filler-2222dddd", "2099.05.01");
    const modern = seed(storeRoot, MODERN_ID, "2099.06.01");
    for (const id of [
      LEGACY_ID,
      "ytdlp-filler-1111cccc",
      "ytdlp-filler-2222dddd",
      MODERN_ID,
    ]) {
      backdate(storeRoot, id);
    }
    publish(storeRoot, legacy.releaseId, 1);
    const layout = getManagedStoreLayout(storeRoot);
    // Only the deferral timer is faked; the filesystem work stays real.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
    await withYtDlpRelease(async () => {
      publish(storeRoot, modern.releaseId, 2, "ytdlp-filler-2222dddd");
      // Arms the throttle while the release is still leased and skipped.
      await collectGarbage();
      expect(fs.existsSync(getReleaseDir(layout, LEGACY_ID))).toBe(true);
    });

    // Suppressed, so nothing happened yet...
    expect(fs.existsSync(getReleaseDir(layout, LEGACY_ID))).toBe(true);
    // ...but the request was kept and fires once the interval elapses.
    await vi.advanceTimersByTimeAsync(YT_DLP_GC_MIN_INTERVAL_MS + 1_000);
    await vi.waitFor(() => {
      expect(fs.existsSync(getReleaseDir(layout, LEGACY_ID))).toBe(false);
    });
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores a release if a reader leases it mid-retirement", async () => {
    // A reader writes its lease before validating the release directory, so a
    // lease can appear while the collector is renaming. Re-checking after the
    // rename - and putting the release back - is what makes the protocol safe
    // without depending on how long a marker stays live.
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    seed(storeRoot, "ytdlp-filler-1111cccc", "2099.04.01");
    seed(storeRoot, "ytdlp-filler-2222dddd", "2099.05.01");
    const modern = seed(storeRoot, MODERN_ID, "2099.06.01");
    for (const id of [
      LEGACY_ID,
      "ytdlp-filler-1111cccc",
      "ytdlp-filler-2222dddd",
      MODERN_ID,
    ]) {
      backdate(storeRoot, id);
    }
    publish(storeRoot, modern.releaseId, 2, "ytdlp-filler-2222dddd");
    const layout = getManagedStoreLayout(storeRoot);

    // A lease that lands after the collector's first check: written directly so
    // it bypasses the marker the collector is about to hold.
    const leaseDir = path.join(layout.leasesDir, legacy.releaseId);
    fs.mkdirSync(leaseDir, { recursive: true });
    // security.ts renames through fs-extra, so that is what has to be observed.
    const realRename = fsExtra.renameSync;
    const renameSpy = vi
      .spyOn(fsExtra, "renameSync")
      .mockImplementationOnce((from: fsExtra.PathLike, to: fsExtra.PathLike) => {
        realRename(from, to);
        fs.writeFileSync(
          path.join(leaseDir, "4242-aabbccddeeff-0123456789abcdef.json"),
          JSON.stringify({
            schemaVersion: 1,
            releaseId: legacy.releaseId,
            instanceId: "4242-aabbccddeeff",
            pid: 4242,
            operationId: "op-0123456789abcdef",
            createdAt: new Date().toISOString(),
          })
        );
      });

    try {
      await collectGarbage();
    } finally {
      renameSpy.mockRestore();
    }

    // The release is back where a reader can resolve it, and nothing is left in
    // the trash.
    expect(fs.existsSync(getReleaseDir(layout, LEGACY_ID))).toBe(true);
    expect(fs.readdirSync(layout.trashDir)).toEqual([]);
  });

  it("leaves no lease behind when acquisition fails", async () => {
    // The lease file is written before the marker and directory checks, and
    // those checks can throw on a malformed store. A lease left behind would
    // pin the release permanently, even after the store is repaired.
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    publish(storeRoot, legacy.releaseId, 1);
    const layout = getManagedStoreLayout(storeRoot);
    fs.mkdirSync(layout.gcMarkersDir, { recursive: true });
    // A file where the marker directory belongs makes the check throw.
    fs.writeFileSync(
      path.join(layout.gcMarkersDir, `${LEGACY_ID}.deleting`),
      "not a directory"
    );

    expect(() => acquireLease(LEGACY_ID, "op-0123456789abcdef")).toThrow();
    expect(listLeaseFilenames(LEGACY_ID)).toEqual([]);
  });

  it("reports success even when the lease cannot be cleaned up", async () => {
    // Cleanup runs in a finally, so anything thrown there would replace the
    // task's result and report a completed download as failed.
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    publish(storeRoot, legacy.releaseId, 1);

    const unlinkSpy = vi
      .spyOn(fsExtra, "unlinkSync")
      .mockImplementation(() => {
        throw Object.assign(new Error("read-only file system"), {
          code: "EROFS",
        });
      });
    try {
      await expect(withYtDlpRelease(async () => "done")).resolves.toBe("done");
    } finally {
      unlinkSpy.mockRestore();
    }
  });

  it("keeps serving when the store cannot hand out leases", async () => {
    // A store problem must degrade rather than fail every operation: a lease
    // directory that cannot be written is not a reason to stop downloading.
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    publish(storeRoot, legacy.releaseId, 1);
    const layout = getManagedStoreLayout(storeRoot);
    fs.mkdirSync(layout.leasesDir, { recursive: true });
    // A file where the per-release lease directory needs to be.
    fs.writeFileSync(path.join(layout.leasesDir, LEGACY_ID), "not a directory");

    const release = await withYtDlpRelease(async (r) => r);

    expect(release.kind).toBe("external");
  });

  it("gives every concurrent reader exactly one complete release", async () => {
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    const modern = seed(storeRoot, MODERN_ID, "2099.06.01");
    publish(storeRoot, legacy.releaseId, 1);

    const readers = Array.from({ length: 24 }, () =>
      withYtDlpRelease(async (release) => ({
        releaseId: release.releaseId,
        pythonPath: String(release.spawnEnv.PYTHONPATH),
      }))
    );
    // Flip current underneath the in-flight acquisitions.
    publish(storeRoot, modern.releaseId, 2, legacy.releaseId);

    const results = await Promise.all(readers);
    for (const result of results) {
      expect([LEGACY_ID, MODERN_ID]).toContain(result.releaseId);
      // Never a mix: the environment must belong to the very release reported.
      const own =
        result.releaseId === LEGACY_ID
          ? legacy.sitePackagesPath
          : modern.sitePackagesPath;
      const other =
        result.releaseId === LEGACY_ID
          ? modern.sitePackagesPath
          : legacy.sitePackagesPath;
      expect(result.pythonPath).toContain(own);
      expect(result.pythonPath).not.toContain(other);
    }
  });

  it("serializes two publishers without regressing current", async () => {
    // Acceptance criterion #8.
    const first = seed(storeRoot, LEGACY_ID, "2099.03.17");
    const second = seed(storeRoot, MODERN_ID, "2099.06.01");
    publish(storeRoot, "ytdlp-origin-9999eeee", 1);
    seed(storeRoot, "ytdlp-origin-9999eeee", "2099.01.01");

    const results = await Promise.allSettled([
      publishValidatedRelease({
        releaseId: second.releaseId,
        version: second.version,
        generationAtInstallStart: 1,
      }),
      publishValidatedRelease({
        releaseId: first.releaseId,
        version: first.version,
        generationAtInstallStart: 1,
      }),
    ]);

    const current = readCurrentManifest(storeRoot);
    expect(current).not.toBeNull();
    expect(current?.generation).toBeGreaterThan(1);
    // Whatever interleaving occurred, current must name a release that exists
    // and must never point back at the older candidate.
    expect(
      fs.existsSync(
        getReleaseDir(getManagedStoreLayout(storeRoot), current!.releaseId)
      )
    ).toBe(true);
    expect(current?.releaseId).toBe(MODERN_ID);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("refuses to lease a release that collection already claimed", async () => {
    // The two-phase marker protocol: a reader arriving after the marker exists
    // must abandon the release and leave no orphan lease behind.
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    publish(storeRoot, legacy.releaseId, 1);

    expect(beginGcMarker(LEGACY_ID)).not.toBeNull();
    // A second collector must not be able to claim the same marker.
    expect(beginGcMarker(LEGACY_ID)).toBeNull();

    expect(() => acquireLease(LEGACY_ID, "op-0123456789abcdef")).toThrow(
      /being deleted/
    );
    expect(listLeaseFilenames(LEGACY_ID)).toEqual([]);
  });

  it("skips collecting a release an existing lease still refers to", async () => {
    const legacy = seed(storeRoot, LEGACY_ID, "2099.03.17");
    seed(storeRoot, "ytdlp-filler-1111cccc", "2099.04.01");
    seed(storeRoot, "ytdlp-filler-2222dddd", "2099.05.01");
    const modern = seed(storeRoot, MODERN_ID, "2099.06.01");
    for (const id of [
      LEGACY_ID,
      "ytdlp-filler-1111cccc",
      "ytdlp-filler-2222dddd",
      MODERN_ID,
    ]) {
      backdate(storeRoot, id);
    }
    publish(storeRoot, modern.releaseId, 2, "ytdlp-filler-2222dddd");

    // A lease written by another backend instance: nothing in this process
    // knows about it, only the file on disk.
    acquireLease(legacy.releaseId, "op-0123456789abcdef");

    await collectGarbage();

    expect(
      fs.existsSync(getReleaseDir(getManagedStoreLayout(storeRoot), LEGACY_ID))
    ).toBe(true);
  });
});
