import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pipInstallToTarget,
  validateStagedRelease,
} from "../../utils/ytdlp/release/candidate";
import { collectGarbage } from "../../utils/ytdlp/release/gc";
import { installManagedRelease } from "../../utils/ytdlp/release/install";
import { discoverPythonInterpreter } from "../../utils/ytdlp/release/interpreter";
import {
  readCurrentManifest,
  resetObservedGenerationForTests,
  writeCurrentManifest,
  writeReleaseManifest,
} from "../../utils/ytdlp/release/manifests";
import {
  ensureManagedStoreLayout,
  getManagedStoreLayout,
  getReleaseDir,
  getSitePackagesPath,
  renameInRoot,
  setManagedStoreRootForTests,
} from "../../utils/ytdlp/release/paths";
import { recoverUsableManagedRelease } from "../../utils/ytdlp/release/recover";
import {
  RELEASE_JSON_FILENAME,
  SITE_PACKAGES_DIRNAME,
  type CurrentManifest,
  type ReleaseManifest,
} from "../../utils/ytdlp/release/types";

const BASE_ID = "ytdlp-base-1111aaaa";
const BASE_VERSION = "2026.07.01";
const CANDIDATE_VERSION = "2026.08.19";

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

// Partial mocks so a single step can be made to fail while the rest of the
// publication path runs for real.
vi.mock("../../utils/ytdlp/release/paths", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/ytdlp/release/paths")>();
  return { ...actual, renameInRoot: vi.fn(actual.renameInRoot) };
});

vi.mock("../../utils/ytdlp/release/manifests", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/ytdlp/release/manifests")>();
  return { ...actual, writeCurrentManifest: vi.fn(actual.writeCurrentManifest) };
});

describe("managed release failure injection", () => {
  let storeRoot: string;
  let baseline: CurrentManifest;

  beforeEach(() => {
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-inject-"));
    setManagedStoreRootForTests(storeRoot);
    resetObservedGenerationForTests();

    seedRelease(BASE_ID, BASE_VERSION);
    baseline = {
      schemaVersion: 1,
      generation: 4,
      releaseId: BASE_ID,
      previousReleaseId: null,
      publishedAt: new Date().toISOString(),
    };
    writeCurrentManifest(storeRoot, baseline);

    vi.mocked(discoverPythonInterpreter).mockResolvedValue({
      command: process.execPath,
      prefixArgs: [],
      executable: process.execPath,
    });
    // A successful pip run leaves a populated target behind.
    vi.mocked(pipInstallToTarget).mockImplementation(
      async (_interpreter, targetDir) => {
        fs.mkdirSync(path.join(targetDir, "yt_dlp"), { recursive: true });
        fs.writeFileSync(path.join(targetDir, "yt_dlp", "__init__.py"), "");
      }
    );
    vi.mocked(validateStagedRelease).mockImplementation(async (input) => {
      const manifest: ReleaseManifest = {
        schemaVersion: 1,
        releaseId: input.createReleaseId(CANDIDATE_VERSION),
        version: CANDIDATE_VERSION,
        installedAt: input.installedAt,
        pythonExecutable: process.execPath,
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
    vi.mocked(renameInRoot).mockReset();
    vi.mocked(writeCurrentManifest).mockReset();
    setManagedStoreRootForTests(null);
    fs.rmSync(storeRoot, { recursive: true, force: true });
  });

  function seedRelease(releaseId: string, version: string): ReleaseManifest {
    const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
    fs.mkdirSync(getSitePackagesPath(layout, releaseId), { recursive: true });
    const manifest: ReleaseManifest = {
      schemaVersion: 1,
      releaseId,
      version,
      installedAt: new Date().toISOString(),
      pythonExecutable: process.execPath,
      pythonPrefixArgs: [],
      sitePackages: SITE_PACKAGES_DIRNAME,
    };
    writeReleaseManifest(storeRoot, manifest);
    return manifest;
  }

  function listReleaseDirs(): string[] {
    return fs
      .readdirSync(getManagedStoreLayout(storeRoot).releasesDir)
      .sort();
  }

  function listStagingDirs(): string[] {
    return fs.readdirSync(getManagedStoreLayout(storeRoot).stagingDir).sort();
  }

  /**
   * The invariant every pre-publication failure must preserve: a reader still
   * gets the complete previous release, never a partial candidate.
   */
  function expectReaderStillSeesBaseline(): void {
    expect(readCurrentManifest(storeRoot)).toEqual(baseline);
    const loaded = recoverUsableManagedRelease(storeRoot);
    expect(loaded?.release.releaseId).toBe(BASE_ID);
    expect(loaded?.release.version).toBe(BASE_VERSION);
    expect(fs.existsSync(loaded!.sitePackagesPath)).toBe(true);
    expect(
      fs.existsSync(path.join(loaded!.releaseDir, RELEASE_JSON_FILENAME))
    ).toBe(true);
  }

  it("keeps current usable when interpreter discovery fails", async () => {
    vi.mocked(discoverPythonInterpreter).mockRejectedValueOnce(
      new Error("No usable Python interpreter with pip was found.")
    );

    await expect(installManagedRelease()).rejects.toThrow(/Python interpreter/);

    expectReaderStillSeesBaseline();
    expect(listReleaseDirs()).toEqual([BASE_ID]);
  });

  it("keeps current usable and cleans staging when pip fails", async () => {
    vi.mocked(pipInstallToTarget).mockRejectedValueOnce(
      new Error("pip install failed: no matching distribution")
    );

    await expect(installManagedRelease()).rejects.toThrow(/pip install failed/);

    expectReaderStillSeesBaseline();
    expect(listReleaseDirs()).toEqual([BASE_ID]);
    expect(listStagingDirs()).toEqual([]);
  });

  it("keeps current usable when validation rejects the candidate", async () => {
    vi.mocked(validateStagedRelease).mockRejectedValueOnce(
      new Error("Candidate yt-dlp --version probe failed")
    );

    await expect(installManagedRelease()).rejects.toThrow(/--version probe/);

    expectReaderStillSeesBaseline();
    // A candidate that failed validation never reaches releases/.
    expect(listReleaseDirs()).toEqual([BASE_ID]);
    expect(listStagingDirs()).toEqual([]);
  });

  it("keeps current usable when finalization fails", async () => {
    vi.mocked(renameInRoot).mockImplementationOnce(() => {
      throw Object.assign(new Error("no space left on device"), {
        code: "ENOSPC",
      });
    });

    await expect(installManagedRelease()).rejects.toThrow(/no space left/);

    expectReaderStillSeesBaseline();
    expect(listReleaseDirs()).toEqual([BASE_ID]);
  });

  it("keeps current usable when publication fails after finalization", async () => {
    vi.mocked(writeCurrentManifest).mockImplementationOnce(() => {
      throw Object.assign(new Error("read-only file system"), { code: "EROFS" });
    });

    await expect(installManagedRelease()).rejects.toThrow(/read-only/);

    // The candidate directory exists but nothing points at it, so the reader
    // still gets the old release; ordinary GC reclaims the orphan later.
    expectReaderStillSeesBaseline();
    expect(listReleaseDirs()).toHaveLength(2);
  });

  it("hands the reader the complete new release immediately after publication", async () => {
    const outcome = await installManagedRelease();

    expect(outcome.published).toBe(true);
    const current = readCurrentManifest(storeRoot);
    expect(current?.generation).toBe(baseline.generation + 1);
    expect(current?.previousReleaseId).toBe(BASE_ID);

    const loaded = recoverUsableManagedRelease(storeRoot);
    expect(loaded?.release.releaseId).toBe(current?.releaseId);
    expect(loaded?.release.version).toBe(CANDIDATE_VERSION);
    // Publishing B never touches A.
    expect(
      fs.existsSync(
        path.join(
          getReleaseDir(getManagedStoreLayout(storeRoot), BASE_ID),
          RELEASE_JSON_FILENAME
        )
      )
    ).toBe(true);
    expect(listStagingDirs()).toEqual([]);
  });

  it("recovers from a corrupt current.json by revalidating and starting a new lineage", async () => {
    const layout = getManagedStoreLayout(storeRoot);
    fs.writeFileSync(layout.currentPath, "{ not json");

    // Recovery falls back to the finalized release without publishing it.
    expect(recoverUsableManagedRelease(storeRoot)?.release.releaseId).toBe(
      BASE_ID
    );
    expect(readCurrentManifest(storeRoot)).toBeNull();

    const outcome = await installManagedRelease();

    expect(outcome.published).toBe(true);
    const current = readCurrentManifest(storeRoot);
    expect(current).not.toBeNull();
    // A new lineage continues past the highest generation this process saw,
    // so a stale reader cannot mistake it for going backwards.
    expect(current!.generation).toBeGreaterThan(baseline.generation);
    expect(recoverUsableManagedRelease(storeRoot)?.release.version).toBe(
      CANDIDATE_VERSION
    );
  });

  it("recovers an unreferenced finalized release when current.json is missing", async () => {
    const layout = getManagedStoreLayout(storeRoot);
    fs.rmSync(layout.currentPath, { force: true });

    const loaded = recoverUsableManagedRelease(storeRoot);
    expect(loaded?.release.releaseId).toBe(BASE_ID);
    expect(fs.existsSync(loaded!.sitePackagesPath)).toBe(true);
  });

  it("cleans stale staging directories but leaves a younger install alone", async () => {
    const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
    const stale = path.join(layout.stagingDir, "op-00000000000000000000");
    const fresh = path.join(layout.stagingDir, "op-11111111111111111111");
    fs.mkdirSync(stale, { recursive: true });
    fs.mkdirSync(fresh, { recursive: true });
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(stale, longAgo, longAgo);

    await collectGarbage();

    // The age threshold is what protects another backend process that is
    // legitimately mid-install in a shared data directory.
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });
});
