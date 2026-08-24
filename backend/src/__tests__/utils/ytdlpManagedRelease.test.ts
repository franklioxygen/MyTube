import { spawn } from "child_process";
import fs from "fs";
import fsExtra from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProviderPluginPath } from "../../services/downloaders/ytdlp/ytdlpHelpers";
import {
  acquireLease,
  atomicReplaceFile,
  collectGarbage,
  decidePublication,
  hasLeases,
  releaseLease,
  recoverUsableManagedRelease,
  resetManagedReleaseStateForTests,
  setManagedStoreRootForTests,
} from "../../utils/ytdlp/release";
import { createManagedRelease } from "../../utils/ytdlp/release/acquire";
import { buildExternalSpawnEnv, buildManagedSpawnEnv } from "../../utils/ytdlp/release/env";
import { spawnYtDlp } from "../../utils/ytdlp/release/launcher";
import { createReleaseId } from "../../utils/ytdlp/release/ids";
import {
  parseCurrentManifest,
  parseReleaseManifest,
  writeCurrentManifest,
  writePublishedManifest,
  writeReleaseManifest,
} from "../../utils/ytdlp/release/manifests";
import {
  ensureManagedStoreLayout,
  getManagedStoreLayout,
  removeGenerationClaim,
  writeJsonExclusive,
  getReleaseDir,
  getSitePackagesPath,
} from "../../utils/ytdlp/release/paths";
import { attachCapabilities } from "../../utils/ytdlp/release/capabilities";
import {
  abortGcMarker,
  beginGcMarker,
  getInstanceId,
} from "../../utils/ytdlp/release/leases";
import {
  acquirePublishLock,
  assertLockOwnership,
  releasePublishLock,
} from "../../utils/ytdlp/release/lock";
import * as manifests from "../../utils/ytdlp/release/manifests";
import { publishValidatedRelease } from "../../utils/ytdlp/release/publish";
import { runProcess } from "../../utils/ytdlp/release/process";
import { logger } from "../../utils/logger";
import {
  CURRENT_JSON_FILENAME,
  SITE_PACKAGES_DIRNAME,
  type CurrentManifest,
  type ReleaseManifest,
} from "../../utils/ytdlp/release/types";

vi.mock("../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderPluginPath: vi.fn(() => "/app/bgutil-ytdlp-pot-provider"),
}));

/** Windows only permits directory symlinks with developer mode or elevation. */
function canCreateDirSymlink(): boolean {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-symlink-probe-"));
  try {
    fs.symlinkSync(os.tmpdir(), path.join(probe, "link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

function makeTempStore(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-store-"));
}

function seedRelease(
  root: string,
  input: { releaseId?: string; version: string; installedAt?: string }
): ReleaseManifest {
  const layout = ensureManagedStoreLayout(getManagedStoreLayout(root));
  const releaseId = input.releaseId ?? createReleaseId(input.version);
  const releaseDir = getReleaseDir(layout, releaseId);
  const sitePackagesPath = getSitePackagesPath(layout, releaseId);
  fs.mkdirSync(sitePackagesPath, { recursive: true });
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    releaseId,
    version: input.version,
    installedAt: input.installedAt ?? new Date().toISOString(),
    pythonExecutable: process.execPath,
    pythonPrefixArgs: [],
    sitePackages: SITE_PACKAGES_DIRNAME,
  };
  writeReleaseManifest(root, manifest);
  expect(fs.existsSync(path.join(releaseDir, "release.json"))).toBe(true);
  return manifest;
}

describe("managed yt-dlp release store", () => {
  let storeRoot: string;

  beforeEach(() => {
    storeRoot = makeTempStore();
    setManagedStoreRootForTests(storeRoot);
    vi.mocked(getProviderPluginPath).mockReturnValue("/app/bgutil-ytdlp-pot-provider");
  });

  afterEach(() => {
    resetManagedReleaseStateForTests();
    fs.rmSync(storeRoot, { recursive: true, force: true });
  });

  describe("manifest validation", () => {
    it("accepts a well-formed release.json and current.json", () => {
      const release = parseReleaseManifest({
        schemaVersion: 1,
        releaseId: "ytdlp-aaaabbbb",
        version: "2026.08.19",
        installedAt: "2026-08-23T20:00:00.000Z",
        pythonExecutable: "/usr/bin/python3",
        pythonPrefixArgs: [],
        sitePackages: "site-packages",
      });
      expect(release.releaseId).toBe("ytdlp-aaaabbbb");

      const current = parseCurrentManifest({
        schemaVersion: 1,
        generation: 3,
        releaseId: "ytdlp-aaaabbbb",
        previousReleaseId: null,
        publishedAt: "2026-08-23T20:00:05.000Z",
      });
      expect(current.generation).toBe(3);
    });

    it("rejects traversal, wrong relative site-packages, and bad ids", () => {
      expect(() =>
        parseReleaseManifest({
          schemaVersion: 1,
          releaseId: "../escape",
          version: "2026.08.19",
          installedAt: "2026-08-23T20:00:00.000Z",
          pythonExecutable: "/usr/bin/python3",
          pythonPrefixArgs: [],
          sitePackages: "site-packages",
        })
      ).toThrow(/releaseId/);

      expect(() =>
        parseReleaseManifest({
          schemaVersion: 1,
          releaseId: "ytdlp-aaaabbbb",
          version: "2026.08.19",
          installedAt: "2026-08-23T20:00:00.000Z",
          pythonExecutable: "/usr/bin/python3",
          pythonPrefixArgs: [],
          sitePackages: "../other",
        })
      ).toThrow(/sitePackages/);
    });
  });

  describe("publication policy", () => {
    it("publishes the first release and rejects same-version or older candidates", () => {
      expect(
        decidePublication({
          current: null,
          currentVersion: null,
          candidateVersion: "2026.08.19",
          candidateReleaseId: "ytdlp-newwwwww",
          generationAtInstallStart: null,
        })
      ).toMatchObject({ action: "publish", generation: 1, previousReleaseId: null });

      const current: CurrentManifest = {
        schemaVersion: 1,
        generation: 4,
        releaseId: "ytdlp-current1",
        previousReleaseId: "ytdlp-prev0001",
        publishedAt: "2026-08-01T00:00:00.000Z",
      };

      expect(
        decidePublication({
          current,
          currentVersion: "2026.08.19",
          candidateVersion: "2026.08.19",
          candidateReleaseId: "ytdlp-same0001",
          generationAtInstallStart: 4,
        })
      ).toMatchObject({ action: "reject" });

      expect(
        decidePublication({
          current,
          currentVersion: "2026.08.19",
          candidateVersion: "2026.07.01",
          candidateReleaseId: "ytdlp-older001",
          generationAtInstallStart: 4,
        })
      ).toMatchObject({ action: "reject" });
    });

    it("rejects an unorderable candidate when generation changed concurrently", () => {
      const current: CurrentManifest = {
        schemaVersion: 1,
        generation: 8,
        releaseId: "ytdlp-current1",
        previousReleaseId: null,
        publishedAt: "2026-08-01T00:00:00.000Z",
      };
      expect(
        decidePublication({
          current,
          currentVersion: "nightly",
          candidateVersion: "master",
          candidateReleaseId: "ytdlp-other001",
          generationAtInstallStart: 7,
        })
      ).toMatchObject({ action: "reject" });
    });
  });

  describe("atomic current.json replacement", () => {
    const manifestJson = (generation: number) =>
      `${JSON.stringify({
        schemaVersion: 1,
        generation,
        releaseId: "ytdlp-aaaabbbb",
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      })}\n`;

    const strayTempFiles = (root: string) =>
      fs.readdirSync(root).filter((name) => name.endsWith(".tmp"));

    it("replaces current.json by rename and never unlinks it first", () => {
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      const unlinkSpy = vi.spyOn(fs, "unlinkSync");
      atomicReplaceFile(layout.currentPath, layout.root, manifestJson(1));

      expect(fs.existsSync(layout.currentPath)).toBe(true);
      expect(path.basename(layout.currentPath)).toBe(CURRENT_JSON_FILENAME);
      expect(
        unlinkSpy.mock.calls.some(([target]) => String(target) === layout.currentPath)
      ).toBe(false);
      unlinkSpy.mockRestore();
    });

    // Windows refuses to replace a file another handle never releases. The
    // contract is that the update fails and the previous manifest survives
    // whole - never an unlink-then-rename that would expose an empty current.
    it("keeps the previous manifest intact when replacement cannot complete", () => {
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      atomicReplaceFile(layout.currentPath, layout.root, manifestJson(1));

      const readerFd = fs.openSync(layout.currentPath, "r");
      let replaced = true;
      try {
        atomicReplaceFile(layout.currentPath, layout.root, manifestJson(2));
      } catch {
        replaced = false;
      } finally {
        fs.closeSync(readerFd);
      }

      // Either outcome is acceptable; a partial or missing manifest is not.
      const observed = JSON.parse(fs.readFileSync(layout.currentPath, "utf8"));
      expect(observed.generation).toBe(replaced ? 2 : 1);
      expect(observed.releaseId).toBe("ytdlp-aaaabbbb");
      // A failed replacement must not leave its temporary file behind.
      expect(strayTempFiles(layout.root)).toEqual([]);
    });

    // The bounded retry exists for exactly this case: a reader that holds the
    // manifest open only briefly. A separate process is used because the
    // publication path is synchronous and blocks its own event loop.
    it("retries the replacement until a transient reader lets go", async () => {
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      atomicReplaceFile(layout.currentPath, layout.root, manifestJson(1));

      const holderScript = [
        'const fs = require("fs");',
        "const fd = fs.openSync(process.argv[1], 'r');",
        'process.stdout.write("open\\n");',
        "setTimeout(() => { try { fs.closeSync(fd); } catch {} }, 300);",
      ].join("\n");
      const holder = spawn(
        process.execPath,
        ["-e", holderScript, "--", layout.currentPath],
        { stdio: ["ignore", "pipe", "pipe"] }
      );

      try {
        await new Promise<void>((resolve, reject) => {
          holder.stdout?.on("data", (chunk: Buffer) => {
            if (chunk.toString().includes("open")) {
              resolve();
            }
          });
          holder.once("error", reject);
        });
        atomicReplaceFile(layout.currentPath, layout.root, manifestJson(2));
      } finally {
        holder.kill();
      }

      expect(
        JSON.parse(fs.readFileSync(layout.currentPath, "utf8")).generation
      ).toBe(2);
      expect(strayTempFiles(layout.root)).toEqual([]);
    });
  });

  describe("command construction", () => {
    const managedRelease = () =>
      createManagedRelease({
        current: null,
        release: {
          schemaVersion: 1,
          releaseId: "ytdlp-command-shape",
          version: "2026.08.19",
          installedAt: new Date().toISOString(),
          pythonExecutable: "/usr/bin/python3",
          pythonPrefixArgs: [],
          sitePackages: SITE_PACKAGES_DIRNAME,
        },
        releaseDir: "/store/releases/ytdlp-command-shape",
        sitePackagesPath: "/store/releases/ytdlp-command-shape/site-packages",
      });

    // Acceptance criterion #9: the command a managed release runs must be
    // identical on every platform.
    it("runs a managed release as <python> -m yt_dlp", () => {
      const release = managedRelease();
      expect(release.command).toBe("/usr/bin/python3");
      expect(release.prefixArgs).toEqual(["-m", "yt_dlp"]);
      expect(release.spawnEnv.PYTHONPATH).toBe(
        [
          "/app/bgutil-ytdlp-pot-provider",
          "/store/releases/ytdlp-command-shape/site-packages",
        ].join(path.delimiter)
      );
    });

    // Runs a real child on each CI platform: argument arrays must survive
    // without shell quoting, and the snapshot environment must win over
    // anything the caller passes.
    it("delivers unquoted arguments and the snapshot env to the child", async () => {
      const reporter = [
        "const out = {",
        "  argv: process.argv.slice(1),",
        "  pythonPath: process.env.PYTHONPATH,",
        "  noUserSite: process.env.PYTHONNOUSERSITE,",
        "  hijacked: process.env.HIJACKED ?? null,",
        "};",
        "console.log(JSON.stringify(out));",
      ].join("\n");

      const release = attachCapabilities({
        kind: "managed",
        releaseId: "ytdlp-command-shape",
        version: "2026.08.19",
        command: process.execPath,
        prefixArgs: ["-e", reporter, "--"],
        spawnEnv: managedRelease().spawnEnv,
      });

      const child = spawnYtDlp(
        release,
        ["--impersonate", "chrome:windows-10", "a b"],
        { env: { HIJACKED: "1" } } as never
      );
      const stdout = await new Promise<string>((resolve) => {
        let buffer = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
        });
        child.on("close", () => resolve(buffer));
      });

      const observed = JSON.parse(stdout);
      expect(observed.argv).toEqual([
        "--impersonate",
        "chrome:windows-10",
        "a b",
      ]);
      // A caller-supplied env cannot replace the release snapshot.
      expect(observed.hijacked).toBeNull();
      expect(observed.noUserSite).toBe("1");
      expect(observed.pythonPath).toContain(
        "/store/releases/ytdlp-command-shape/site-packages"
      );
    });
  });

  describe("spawn environment", () => {
    it("replaces PYTHONPATH for managed releases and sets PYTHONNOUSERSITE", () => {
      const env = buildManagedSpawnEnv("/store/releases/a/site-packages", {
        PATH: "/usr/bin",
        PYTHONPATH: "/ambient/site",
        HOME: "/app/data/.home",
      });
      expect(env.PYTHONPATH).toBe(
        ["/app/bgutil-ytdlp-pot-provider", "/store/releases/a/site-packages"].join(
          path.delimiter
        )
      );
      expect(env.PYTHONPATH).not.toContain("/ambient/site");
      expect(env.PYTHONNOUSERSITE).toBe("1");
      expect(env.PATH).toBe("/usr/bin");
    });

    it("prepends the bundled provider for external releases and keeps ambient PYTHONPATH", () => {
      const env = buildExternalSpawnEnv({
        PYTHONPATH: "/ambient/site",
      });
      expect(env.PYTHONPATH?.split(path.delimiter)[0]).toBe(
        "/app/bgutil-ytdlp-pot-provider"
      );
      expect(env.PYTHONPATH).toContain("/ambient/site");
      expect(env.PYTHONNOUSERSITE).toBeUndefined();
    });
  });

  describe("leases and GC", () => {
    // Retention keeps the newest current-plus-two, so seeds need distinct ages.
    const daysAgo = (days: number): string =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    /** Backdate a release directory past the minimum retention age. */
    function ageReleaseDir(
      layout: ReturnType<typeof getManagedStoreLayout>,
      releaseId: string
    ): void {
      const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      fs.utimesSync(getReleaseDir(layout, releaseId), old, old);
    }

    it("keeps current, previous, and leased releases", async () => {
      const currentRel = seedRelease(storeRoot, {
        version: "2026.08.19",
        installedAt: daysAgo(1),
      });
      const previousRel = seedRelease(storeRoot, {
        version: "2026.07.01",
        installedAt: daysAgo(2),
      });
      const leasedRel = seedRelease(storeRoot, {
        version: "2026.05.01",
        installedAt: daysAgo(3),
      });
      const unusedRel = seedRelease(storeRoot, {
        version: "2026.06.01",
        installedAt: daysAgo(4),
      });

      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 4,
        releaseId: currentRel.releaseId,
        previousReleaseId: previousRel.releaseId,
        publishedAt: new Date().toISOString(),
      });

      const layout = getManagedStoreLayout(storeRoot);
      for (const release of [currentRel, previousRel, leasedRel, unusedRel]) {
        ageReleaseDir(layout, release.releaseId);
      }

      const lease = acquireLease(leasedRel.releaseId, "op-0123456789abcdef");
      expect(hasLeases(leasedRel.releaseId)).toBe(true);

      await collectGarbage();

      expect(fs.existsSync(getReleaseDir(layout, currentRel.releaseId))).toBe(true);
      expect(fs.existsSync(getReleaseDir(layout, previousRel.releaseId))).toBe(true);
      expect(fs.existsSync(getReleaseDir(layout, leasedRel.releaseId))).toBe(true);
      expect(fs.existsSync(getReleaseDir(layout, unusedRel.releaseId))).toBe(false);

      releaseLease(lease.releaseId, lease.leaseFilename);
      expect(hasLeases(leasedRel.releaseId)).toBe(false);
    });

    it("never collects a release younger than the retention age", async () => {
      // An installer finalizes a release directory before it publishes the new
      // current pointer. Collecting in that window would delete the release a
      // publisher is about to point at — and the manifest date says nothing
      // about when the directory appeared.
      const currentRel = seedRelease(storeRoot, {
        version: "2026.08.19",
        installedAt: daysAgo(1),
      });
      seedRelease(storeRoot, { version: "2026.08.18", installedAt: daysAgo(2) });
      seedRelease(storeRoot, { version: "2026.08.17", installedAt: daysAgo(3) });
      const justFinalized = seedRelease(storeRoot, {
        version: "2026.08.16",
        installedAt: daysAgo(4),
      });

      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 1,
        releaseId: currentRel.releaseId,
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      });

      await collectGarbage();

      const layout = getManagedStoreLayout(storeRoot);
      expect(fs.existsSync(getReleaseDir(layout, justFinalized.releaseId))).toBe(
        true
      );
    });

    it("keeps a rollback window when current.json is unreadable", async () => {
      const releases = [
        seedRelease(storeRoot, { version: "2026.08.19", installedAt: daysAgo(1) }),
        seedRelease(storeRoot, { version: "2026.07.01", installedAt: daysAgo(2) }),
        seedRelease(storeRoot, { version: "2026.06.01", installedAt: daysAgo(3) }),
        seedRelease(storeRoot, { version: "2026.05.01", installedAt: daysAgo(4) }),
      ];
      const layout = getManagedStoreLayout(storeRoot);
      for (const release of releases) {
        ageReleaseDir(layout, release.releaseId);
      }
      fs.writeFileSync(path.join(layout.root, CURRENT_JSON_FILENAME), "{ broken");

      await collectGarbage();

      // Newest three (current plus two rollbacks) survive; the oldest goes.
      const survivors = releases.filter((release) =>
        fs.existsSync(getReleaseDir(layout, release.releaseId))
      );
      expect(survivors).toHaveLength(3);
      expect(fs.existsSync(getReleaseDir(layout, releases[3].releaseId))).toBe(
        false
      );
    });
  });

  describe("publication fencing", () => {
    it("refuses to move the pointer once its lock has been reclaimed", async () => {
      const first = seedRelease(storeRoot, { version: "2026.07.01" });
      const candidate = seedRelease(storeRoot, { version: "2026.08.19" });
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 1,
        releaseId: first.releaseId,
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      });
      const layout = getManagedStoreLayout(storeRoot);

      // Simulate another backend reclaiming the lock while this publisher is
      // recording its publication: the owner file changes between the two
      // ownership checks that bracket the record write.
      const realWrite = manifests.writePublishedManifest;
      const spy = vi
        .spyOn(manifests, "writePublishedManifest")
        .mockImplementation((root, manifest) => {
          realWrite(root, manifest);
          fs.writeFileSync(
            path.join(layout.publishLockDir, "owner.json"),
            JSON.stringify({
              operationId: "op-0123456789abcdef",
              nonce: "f".repeat(32),
              pid: 4242,
              instanceId: "4242-aabbccddeeff",
              createdAt: new Date().toISOString(),
            })
          );
        });

      try {
        await expect(
          publishValidatedRelease({
            releaseId: candidate.releaseId,
            version: "2026.08.19",
            generationAtInstallStart: 1,
          })
        ).rejects.toThrow(/stolen/);
      } finally {
        spy.mockRestore();
      }

      // The pointer never moved...
      expect(manifests.readCurrentManifest(storeRoot)?.releaseId).toBe(first.releaseId);
      // ...and the publication record was withdrawn, so recovery cannot later
      // promote a transition that never committed.
      expect(
        fs.existsSync(
          path.join(getReleaseDir(layout, candidate.releaseId), "published.json")
        )
      ).toBe(false);
    });
  });

  describe("generation claims", () => {
    it("lets only one publisher own a generation", async () => {
      const base = seedRelease(storeRoot, { version: "2026.07.01" });
      const first = seedRelease(storeRoot, { version: "2026.08.19" });
      const second = seedRelease(storeRoot, { version: "2026.08.20" });
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 1,
        releaseId: base.releaseId,
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      });

      const winner = await publishValidatedRelease({
        releaseId: first.releaseId,
        version: "2026.08.19",
        generationAtInstallStart: 1,
      });
      expect(winner.published).toBe(true);
      expect(winner.current?.generation).toBe(2);

      // A publisher that decided from the same current.json computes the same
      // generation. Exclusive creation is what makes the swap a real
      // compare-and-swap rather than a check followed by a write, so this one
      // must lose even though it never noticed the winner.
      fs.writeFileSync(
        path.join(getManagedStoreLayout(storeRoot).root, "current.json"),
        JSON.stringify({
          schemaVersion: 1,
          generation: 1,
          releaseId: base.releaseId,
          previousReleaseId: null,
          publishedAt: new Date().toISOString(),
        })
      );

      await expect(
        publishValidatedRelease({
          releaseId: second.releaseId,
          version: "2026.08.20",
          generationAtInstallStart: 1,
        })
      ).rejects.toThrow(/generation 2 was claimed/);

      // The loser left nothing behind that recovery could promote.
      expect(
        fs.existsSync(
          path.join(getReleaseDir(getManagedStoreLayout(storeRoot), second.releaseId), "published.json")
        )
      ).toBe(false);
    });
  });

  describe("per-release coordination directories", () => {
    it.skipIf(!canCreateDirSymlink())(
      "refuses a symlinked lease or marker directory",
      () => {
        // Created on demand per release, so they are not covered by the store
        // layout checks. Following a link would write a lease outside the store.
        const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
        const release = seedRelease(storeRoot, { version: "2026.08.19" });
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-coord-"));
        try {
          fs.mkdirSync(layout.leasesDir, { recursive: true });
          fs.symlinkSync(
            outside,
            path.join(layout.leasesDir, release.releaseId),
            "dir"
          );
          expect(() =>
            acquireLease(release.releaseId, "op-0123456789abcdef")
          ).toThrow(/symlink/i);

          fs.mkdirSync(layout.gcMarkersDir, { recursive: true });
          fs.symlinkSync(
            outside,
            path.join(layout.gcMarkersDir, `${release.releaseId}.deleting`),
            "dir"
          );
          expect(beginGcMarker(release.releaseId)).toBeNull();
          expect(fs.readdirSync(outside)).toEqual([]);
        } finally {
          fs.rmSync(outside, { recursive: true, force: true });
        }
      }
    );
  });

  describe("retiring a release", () => {
    it("makes a release unreachable before deleting it, and sweeps leftovers", async () => {
      // The marker only has to cover the rename, not the deletion - so a slow
      // or suspended delete cannot outlive it and let a reader lease a
      // half-removed release.
      const daysAgo = (days: number) =>
        new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const current = seedRelease(storeRoot, { version: "2026.08.19" });
      const keep = [
        seedRelease(storeRoot, { version: "2026.07.01", installedAt: daysAgo(10) }),
        seedRelease(storeRoot, { version: "2026.06.01", installedAt: daysAgo(20) }),
      ];
      const doomed = seedRelease(storeRoot, {
        version: "2026.05.01",
        installedAt: daysAgo(30),
      });
      const layout = getManagedStoreLayout(storeRoot);
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      for (const release of [...keep, doomed]) {
        fs.utimesSync(getReleaseDir(layout, release.releaseId), old, old);
      }
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 1,
        releaseId: current.releaseId,
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      });

      await collectGarbage();

      expect(fs.existsSync(getReleaseDir(layout, doomed.releaseId))).toBe(false);
      // Nothing is stranded: the trash is emptied as part of the same pass.
      expect(fs.readdirSync(layout.trashDir)).toEqual([]);
      // And no marker is left holding the release hostage.
      expect(
        fs.existsSync(path.join(layout.gcMarkersDir, `${doomed.releaseId}.deleting`))
          ? fs.readdirSync(
              path.join(layout.gcMarkersDir, `${doomed.releaseId}.deleting`)
            )
          : []
      ).toEqual([]);
    });

    it("sweeps a retired release a previous collector failed to delete", async () => {
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      const stranded = path.join(layout.trashDir, "ytdlp-old-1111aaaa.abcdef0123456789");
      fs.mkdirSync(path.join(stranded, "site-packages"), { recursive: true });

      await collectGarbage();

      // Entries here are unreachable by construction, so they need no reasoning
      // about age or ownership.
      expect(fs.existsSync(stranded)).toBe(false);
    });
  });

  describe("deletion markers", () => {
    it("blocks a second collector, ignores an expired one, and only removes its own", () => {
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      const release = seedRelease(storeRoot, { version: "2026.08.19" });
      const markerDir = path.join(
        layout.gcMarkersDir,
        `${release.releaseId}.deleting`
      );

      const first = beginGcMarker(release.releaseId);
      expect(first).not.toBeNull();
      // A live marker still blocks another collector and any reader.
      expect(beginGcMarker(release.releaseId)).toBeNull();
      expect(() => acquireLease(release.releaseId, "op-0123456789abcdef")).toThrow(
        /being deleted/
      );

      // A collector killed mid-collection leaves its marker behind. It is
      // ignored once expired rather than reclaimed, so nothing ever deletes a
      // marker it does not own.
      const markerPath = path.join(markerDir, `${first}.json`);
      const longAgo = new Date(Date.now() - 10 * 60 * 1000);
      fs.utimesSync(markerPath, longAgo, longAgo);

      const second = beginGcMarker(release.releaseId);
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);

      // The original collector resuming removes only its own file, leaving the
      // replacement's marker - and the release - protected.
      abortGcMarker(release.releaseId, first as string);
      expect(fs.existsSync(path.join(markerDir, `${second}.json`))).toBe(true);
      expect(() => acquireLease(release.releaseId, "op-0123456789abcdef")).toThrow(
        /being deleted/
      );

      abortGcMarker(release.releaseId, second as string);
      expect(fs.readdirSync(markerDir)).toEqual([]);
    });
  });

  describe("generation claim cleanup", () => {
    it("frees the claim when publication fails so later updates still work", async () => {
      const base = seedRelease(storeRoot, { version: "2026.07.01" });
      const failing = seedRelease(storeRoot, { version: "2026.08.19" });
      const later = seedRelease(storeRoot, { version: "2026.08.20" });
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 1,
        releaseId: base.releaseId,
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      });

      // Fail after the generation is claimed but before the pointer moves.
      const spy = vi
        .spyOn(manifests, "writeCurrentManifest")
        .mockImplementationOnce(() => {
          throw new Error("read-only file system");
        });
      try {
        await expect(
          publishValidatedRelease({
            releaseId: failing.releaseId,
            version: "2026.08.19",
            generationAtInstallStart: 1,
          })
        ).rejects.toThrow(/read-only/);
      } finally {
        spy.mockRestore();
      }

      // The claim must not survive: every later publisher computes the same
      // generation from the unchanged pointer and would be rejected forever.
      const layout = getManagedStoreLayout(storeRoot);
      expect(fs.existsSync(path.join(layout.generationsDir, "2.json"))).toBe(
        false
      );

      const retry = await publishValidatedRelease({
        releaseId: later.releaseId,
        version: "2026.08.20",
        generationAtInstallStart: 1,
      });
      expect(retry.published).toBe(true);
      expect(retry.current?.generation).toBe(2);
    });
  });

  describe("generation claim ownership", () => {
    it("does not let a resumed publisher drop a replacement's claim", () => {
      // Claims are reclaimable by age, so a suspended publisher can have its
      // claim taken over. If it then removed the replacement's claim, a third
      // publisher could commit the same generation and defeat the fence.
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      const claimPath = path.join(layout.generationsDir, "7.json");
      writeJsonExclusive(claimPath, {
        releaseId: "ytdlp-replacement-3333cccc",
        claimedAt: new Date().toISOString(),
        token: "b".repeat(32),
      });

      // The original publisher's token no longer matches.
      removeGenerationClaim(layout, 7, "a".repeat(32));
      expect(fs.existsSync(claimPath)).toBe(true);

      removeGenerationClaim(layout, 7, "b".repeat(32));
      expect(fs.existsSync(claimPath)).toBe(false);
    });
  });

  describe("reclaiming an abandoned generation", () => {
    it("drops the publication record the dead publisher left behind", async () => {
      // A backend can die between recording its publication and moving the
      // pointer. Freeing the generation without dropping that record leaves two
      // releases claiming it, and both recovery and the rollback window order
      // by generation.
      const base = seedRelease(storeRoot, { version: "2026.07.01" });
      const abandoned = seedRelease(storeRoot, { version: "2026.08.19" });
      const next = seedRelease(storeRoot, { version: "2026.08.20" });
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 1,
        releaseId: base.releaseId,
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      });
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));

      // Exactly what a crash between the two writes leaves behind.
      writePublishedManifest(storeRoot, {
        schemaVersion: 1,
        releaseId: abandoned.releaseId,
        generation: 2,
        previousReleaseId: base.releaseId,
        publishedAt: new Date().toISOString(),
      });
      const claimPath = path.join(layout.generationsDir, "2.json");
      writeJsonExclusive(claimPath, {
        releaseId: abandoned.releaseId,
        claimedAt: new Date().toISOString(),
        token: "c".repeat(32),
      });
      const longAgo = new Date(Date.now() - 10 * 60 * 1000);
      fs.utimesSync(claimPath, longAgo, longAgo);

      const outcome = await publishValidatedRelease({
        releaseId: next.releaseId,
        version: "2026.08.20",
        generationAtInstallStart: 1,
      });

      expect(outcome.published).toBe(true);
      expect(outcome.current?.generation).toBe(2);
      // Only one release records generation 2.
      expect(
        fs.existsSync(
          path.join(getReleaseDir(layout, abandoned.releaseId), "published.json")
        )
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(getReleaseDir(layout, next.releaseId), "published.json")
        )
      ).toBe(true);
    });
  });

  describe("failed publication cleanup", () => {
    it("keeps the generation claimed while its record cannot be removed", async () => {
      // Freeing the generation while the record survives would let the next
      // update reuse it, leaving two releases recording the same generation.
      const base = seedRelease(storeRoot, { version: "2026.07.01" });
      const failing = seedRelease(storeRoot, { version: "2026.08.19" });
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 1,
        releaseId: base.releaseId,
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      });
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));

      const pointerSpy = vi
        .spyOn(manifests, "writeCurrentManifest")
        .mockImplementationOnce(() => {
          throw new Error("read-only file system");
        });
      const unlinkSpy = vi
        .spyOn(fsExtra, "unlinkSync")
        .mockImplementation((target: fsExtra.PathLike) => {
          if (String(target).endsWith("published.json")) {
            throw Object.assign(new Error("sharing violation"), {
              code: "EPERM",
            });
          }
          return undefined as never;
        });
      try {
        await expect(
          publishValidatedRelease({
            releaseId: failing.releaseId,
            version: "2026.08.19",
            generationAtInstallStart: 1,
          })
        ).rejects.toThrow(/read-only/);
      } finally {
        unlinkSpy.mockRestore();
        pointerSpy.mockRestore();
      }

      // The record survived, so the generation must still be claimed.
      expect(
        fs.existsSync(
          path.join(getReleaseDir(layout, failing.releaseId), "published.json")
        )
      ).toBe(true);
      expect(fs.existsSync(path.join(layout.generationsDir, "2.json"))).toBe(
        true
      );
    });
  });

  describe("in-flight retirement", () => {
    it("does not sweep a retirement that still holds its marker", async () => {
      // Between the retirement rename and the lease re-check that may put the
      // release back, it sits in the trash. A concurrent sweep would make that
      // restoration impossible and leave a leaseholder on removed modules.
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      const release = seedRelease(storeRoot, { version: "2026.08.19" });
      const token = beginGcMarker(release.releaseId);
      expect(token).not.toBeNull();

      const inFlight = path.join(
        layout.trashDir,
        `${release.releaseId}.${token}`
      );
      fs.mkdirSync(inFlight, { recursive: true });
      // A retirement whose collector is gone: no live marker for this token.
      const abandoned = path.join(
        layout.trashDir,
        `${release.releaseId}.0123456789abcdef`
      );
      fs.mkdirSync(abandoned, { recursive: true });

      await collectGarbage();

      expect(fs.existsSync(inFlight)).toBe(true);
      expect(fs.existsSync(abandoned)).toBe(false);

      // Once the collector is done, its entry is swept like any other.
      abortGcMarker(release.releaseId, token as string);
      await collectGarbage();
      expect(fs.existsSync(inFlight)).toBe(false);
    });
  });

  describe("reclaiming an abandoned generation", () => {
    it("keeps the generation claimed when the abandoned record survives", async () => {
      // Same rule as the immediate-failure path: never free a generation while
      // a release still records it.
      const base = seedRelease(storeRoot, { version: "2026.07.01" });
      const abandoned = seedRelease(storeRoot, { version: "2026.08.19" });
      const next = seedRelease(storeRoot, { version: "2026.08.20" });
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 1,
        releaseId: base.releaseId,
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      });
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      writePublishedManifest(storeRoot, {
        schemaVersion: 1,
        releaseId: abandoned.releaseId,
        generation: 2,
        previousReleaseId: base.releaseId,
        publishedAt: new Date().toISOString(),
      });
      const claimPath = path.join(layout.generationsDir, "2.json");
      writeJsonExclusive(claimPath, {
        releaseId: abandoned.releaseId,
        claimedAt: new Date().toISOString(),
        token: "d".repeat(32),
      });
      const longAgo = new Date(Date.now() - 10 * 60 * 1000);
      fs.utimesSync(claimPath, longAgo, longAgo);

      const unlinkSpy = vi
        .spyOn(fsExtra, "unlinkSync")
        .mockImplementation((target: fsExtra.PathLike) => {
          if (String(target).endsWith("published.json")) {
            throw Object.assign(new Error("sharing violation"), {
              code: "EPERM",
            });
          }
          return undefined as never;
        });
      try {
        await expect(
          publishValidatedRelease({
            releaseId: next.releaseId,
            version: "2026.08.20",
            generationAtInstallStart: 1,
          })
        ).rejects.toThrow(/claimed by another publisher/);
      } finally {
        unlinkSpy.mockRestore();
      }

      // The generation is still claimed, so nothing else can reuse it while a
      // release still records it.
      expect(fs.existsSync(claimPath)).toBe(true);
    });
  });

  describe("repairing a broken release", () => {
    it("publishes a same-version candidate when the current release is unusable", () => {
      // pip keeps producing the same latest version, so a repair would be
      // rejected as a no-op and the broken release would stay current forever.
      const shared = {
        current: {
          schemaVersion: 1 as const,
          generation: 3,
          releaseId: "ytdlp-broken-1111aaaa",
          previousReleaseId: null,
          publishedAt: new Date().toISOString(),
        },
        currentVersion: "2026.08.19",
        candidateVersion: "2026.08.19",
        candidateReleaseId: "ytdlp-repair-2222bbbb",
        generationAtInstallStart: 3,
      };

      expect(decidePublication(shared)).toMatchObject({
        action: "reject",
        kind: "already-current",
      });
      expect(
        decidePublication({ ...shared, currentIsUsable: false })
      ).toMatchObject({ action: "publish", generation: 4 });
    });
  });

  describe("rollback window", () => {
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    function publishRecord(
      releaseId: string,
      generation: number,
      previousReleaseId: string | null = null
    ): void {
      writePublishedManifest(storeRoot, {
        schemaVersion: 1,
        releaseId,
        generation,
        previousReleaseId,
        publishedAt: new Date().toISOString(),
      });
    }

    it("keeps published rollback targets even when a rejected candidate is newer", async () => {
      // An already-current update finalizes a candidate that is never
      // published. Counting it toward current-plus-two would displace a real
      // rollback target and collect it.
      const oldest = seedRelease(storeRoot, {
        version: "2026.06.01",
        installedAt: daysAgo(30),
      });
      const previous = seedRelease(storeRoot, {
        version: "2026.07.01",
        installedAt: daysAgo(20),
      });
      const current = seedRelease(storeRoot, {
        version: "2026.08.19",
        installedAt: daysAgo(10),
      });
      // Finalized moments after the others, but rejected at publication.
      const rejected = seedRelease(storeRoot, {
        version: "2026.08.19",
        installedAt: daysAgo(1),
      });

      publishRecord(oldest.releaseId, 1);
      publishRecord(previous.releaseId, 2, oldest.releaseId);
      publishRecord(current.releaseId, 3, previous.releaseId);

      const layout = getManagedStoreLayout(storeRoot);
      const long = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      for (const release of [oldest, previous, current, rejected]) {
        fs.utimesSync(getReleaseDir(layout, release.releaseId), long, long);
      }
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 3,
        releaseId: current.releaseId,
        previousReleaseId: previous.releaseId,
        publishedAt: new Date().toISOString(),
      });

      await collectGarbage();

      // current + the two published rollback targets survive...
      for (const release of [current, previous, oldest]) {
        expect(
          fs.existsSync(getReleaseDir(layout, release.releaseId))
        ).toBe(true);
      }
      // ...and the never-published candidate is what gets collected.
      expect(fs.existsSync(getReleaseDir(layout, rejected.releaseId))).toBe(
        false
      );
    });
  });

  describe("store recovery", () => {
    it("falls back to the previous release when current is unusable", () => {
      const previousRel = seedRelease(storeRoot, { version: "2026.07.01" });
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 2,
        releaseId: "ytdlp-missingrelease",
        previousReleaseId: previousRel.releaseId,
        publishedAt: new Date().toISOString(),
      });

      expect(recoverUsableManagedRelease(storeRoot)?.release.releaseId).toBe(
        previousRel.releaseId
      );
    });

    it("degrades to external discovery instead of throwing on a broken store", () => {
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      // Unexpected content where the store expects a directory. The backend
      // must still serve rather than fail every yt-dlp operation.
      fs.rmSync(layout.releasesDir, { recursive: true, force: true });
      fs.writeFileSync(layout.releasesDir, "not a directory");

      expect(recoverUsableManagedRelease(storeRoot)).toBeNull();
    });

    it("does not recover a conflict-rejected finalized candidate", () => {
      const twoDaysAgo = new Date(
        Date.now() - 2 * 24 * 60 * 60 * 1000
      ).toISOString();
      const oneDayAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000
      ).toISOString();
      const published = seedRelease(storeRoot, {
        version: "2026.08.20",
        installedAt: twoDaysAgo,
      });
      const rejected = seedRelease(storeRoot, {
        version: "2026.08.19",
        installedAt: oneDayAgo,
      });
      writePublishedManifest(storeRoot, {
        schemaVersion: 1,
        releaseId: published.releaseId,
        generation: 2,
        previousReleaseId: null,
        publishedAt: twoDaysAgo,
      });
      fs.writeFileSync(getManagedStoreLayout(storeRoot).currentPath, "{ broken");

      const recovered = recoverUsableManagedRelease(storeRoot);
      expect(recovered?.release.releaseId).toBe(published.releaseId);
      expect(recovered?.release.releaseId).not.toBe(rejected.releaseId);
    });

    it.skipIf(!canCreateDirSymlink())(
      "refuses to prepare a store whose staging directory is a symlink",
      () => {
        // Otherwise `pip --target` would write outside the managed store and
        // staging cleanup would delete through the link.
        const layout = getManagedStoreLayout(storeRoot);
        fs.mkdirSync(layout.root, { recursive: true });
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-outside-"));
        try {
          fs.symlinkSync(outside, layout.stagingDir, "dir");
          expect(() => ensureManagedStoreLayout(layout)).toThrow(/symlink/i);
        } finally {
          fs.rmSync(outside, { recursive: true, force: true });
        }
      }
    );

    // Directory symlinks need elevation on Windows, so this one is skipped
    // where the runner cannot create them.
    it.skipIf(!canCreateDirSymlink())(
      "refuses a symlinked releases directory",
      () => {
        const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
        fs.rmSync(layout.releasesDir, { recursive: true, force: true });
        fs.symlinkSync(os.tmpdir(), layout.releasesDir, "dir");

        expect(recoverUsableManagedRelease(storeRoot)).toBeNull();
      }
    );
  });

  describe("release-scoped capabilities", () => {
    it("caches a definitive absence but retries an incomplete probe", async () => {
      const release = attachCapabilities({
        kind: "managed",
        releaseId: "ytdlp-capability-probe",
        version: "2026.08.19",
        command: process.execPath,
        prefixArgs: [],
        spawnEnv: process.env,
      });

      // An old yt-dlp exits non-zero on --list-impersonate-targets. That is the
      // release telling us the feature is missing, so the other capabilities
      // parsed from --help must survive and the answer must be cached.
      const first = await release.capabilities;
      expect(first.impersonateAvailable).toBe(false);
      expect(await release.capabilities).toBe(first);
    });

    it("reprobes a mutable external install on a new acquisition", async () => {
      const markerPath = path.join(storeRoot, "curl-cffi-installed");
      const probePath = path.join(storeRoot, "mutable-ytdlp.cjs");
      fs.writeFileSync(
        probePath,
        [
          'const fs = require("fs");',
          `const marker = ${JSON.stringify(markerPath)};`,
          'if (process.argv.includes("--help")) {',
          '  console.log("--js-runtimes --remote-components");',
          '} else if (process.argv.includes("--list-impersonate-targets")) {',
          "  const target = fs.existsSync(marker)",
          '    ? "chrome curl_cffi"',
          '    : "chrome curl_cffi unavailable";',
          "  console.log(target);",
          "}",
        ].join("\n")
      );
      const acquireExternal = () =>
        attachCapabilities({
          kind: "external",
          releaseId: `external:${probePath}:2026.08.20`,
          version: "2026.08.20",
          command: process.execPath,
          prefixArgs: [probePath],
          spawnEnv: process.env,
        });

      const before = acquireExternal();
      expect((await before.capabilities).impersonateAvailable).toBe(false);

      fs.writeFileSync(markerPath, "installed");
      const after = acquireExternal();
      expect((await after.capabilities).impersonateAvailable).toBe(true);
    });
  });

  describe("pip timeout", () => {
    it("kills a hung child and reports timedOut", async () => {
      const result = await runProcess(
        process.execPath,
        ["-e", "setTimeout(() => {}, 60_000)"],
        { timeoutMs: 50 }
      );
      expect(result.timedOut).toBe(true);
    });

    // `child.killed` is true the moment SIGTERM is *sent*, so gating the
    // escalation on it would leave a SIGTERM-ignoring pip running forever with
    // runProcess never resolving - wedging the process-wide pip queue.
    it("terminates a child that ignores SIGTERM instead of waiting forever", async () => {
      const stubborn = [
        'process.on("SIGTERM", () => {});',
        'process.stdout.write("ready\\n");',
        "setTimeout(() => {}, 60_000);",
      ].join("\n");

      // Generous enough that the child has certainly booted and installed its
      // handler before the timeout fires; a shorter window races process
      // startup under load and the default SIGTERM action wins instead.
      const result = await runProcess(process.execPath, ["-e", stubborn], {
        timeoutMs: 1_500,
      });

      expect(result.timedOut).toBe(true);
      // A reported signal can only come from an observed exit: the last-resort
      // timer reports none. So this is a deterministic check that the child was
      // really terminated, with no reliance on elapsed time.
      if (process.platform === "win32") {
        // Windows has no signal delivery: the timeout path shells out to
        // taskkill /F, so the child reports an exit code and no signal. A
        // non-null code still proves it was terminated rather than abandoned,
        // since the last-resort timer reports neither.
        expect(result.code).not.toBeNull();
        return;
      }
      expect(result.signal).toBe("SIGKILL");
    }, 20_000);
  });

  describe("process tree termination", () => {
    it("terminates a grandchild the timed-out process launched", async () => {
      // pip spawns build and download helpers. Signalling only the interpreter
      // leaves those running against the staging directory the failure path is
      // about to delete, and lets the next install start alongside them.
      const marker = path.join(storeRoot, "grandchild-heartbeat");
      // Paths travel as argv rather than being interpolated into source: it
      // keeps the scripts constant and avoids building code from values.
      const grandchild = [
        "const fs = require('fs');",
        "const target = process.argv[1];",
        "setInterval(() => fs.writeFileSync(target, String(Date.now())), 50);",
        "setTimeout(() => process.exit(0), 60000);",
      ].join("\n");
      const parent = [
        "const { spawn } = require('child_process');",
        "const script = process.argv[1];",
        "const target = process.argv[2];",
        "spawn(process.execPath, ['-e', script, '--', target], { stdio: 'ignore' });",
        "setTimeout(() => {}, 60000);",
      ].join("\n");

      const result = await runProcess(
        process.execPath,
        ["-e", parent, "--", grandchild, marker],
        { timeoutMs: 1_500 }
      );
      expect(result.timedOut).toBe(true);
      // The grandchild must actually have run, or this test would pass
      // vacuously by observing nothing on both sides.
      expect(fs.existsSync(marker)).toBe(true);

      // Give any survivor room to write again, then confirm it stopped when
      // its parent was killed.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const settled = fs.readFileSync(marker, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(fs.readFileSync(marker, "utf8")).toBe(settled);
    }, 20_000);
  });

  describe("publish lock recovery", () => {
    function writeLockOwner(owner: Record<string, unknown>): string {
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      fs.mkdirSync(layout.publishLockDir, { recursive: true });
      const ownerPath = path.join(layout.publishLockDir, "owner.json");
      fs.writeFileSync(ownerPath, JSON.stringify(owner));
      return ownerPath;
    }

    const expiredOwner = (overrides: Record<string, unknown> = {}) => ({
      operationId: "op-0123456789abcdef",
      nonce: "0123456789abcdef0123456789abcdef",
      // A restarted container routinely hands the replacement backend the same
      // PID, so this one is alive and belongs to somebody else entirely.
      pid: process.pid,
      instanceId: "1-deadbeefdead",
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      ...overrides,
    });

    it("recovers an expired lock whose recorded pid has been reused", async () => {
      writeLockOwner(expiredOwner());

      const lock = await acquirePublishLock(
        getManagedStoreLayout(storeRoot),
        2000
      );

      expect(lock.owner.nonce).not.toBe(
        "0123456789abcdef0123456789abcdef"
      );
      releasePublishLock(lock);
    });

    it("leaves a lock held by this very instance alone", async () => {
      // Our own process is wedged; stealing from ourselves helps nobody.
      writeLockOwner(expiredOwner({ instanceId: getInstanceId() }));

      await expect(
        acquirePublishLock(getManagedStoreLayout(storeRoot), 300)
      ).rejects.toThrow(/Timed out waiting/);
    });

    it("never deletes a young lock directory that has no owner file yet", async () => {
      // A contender can arrive between another process's mkdir and its owner
      // write. Reclaiming then would destroy a lock that is about to be valid,
      // and let both processes believe they hold it.
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      fs.mkdirSync(layout.publishLockDir, { recursive: true });

      await expect(
        acquirePublishLock(layout, 300)
      ).rejects.toThrow(/Timed out waiting/);
      expect(fs.existsSync(layout.publishLockDir)).toBe(true);
    });

    it("reclaims a lock directory left without an owner file", async () => {
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      fs.mkdirSync(layout.publishLockDir, { recursive: true });
      const longAgo = new Date(Date.now() - 10 * 60 * 1000);
      fs.utimesSync(layout.publishLockDir, longAgo, longAgo);

      const lock = await acquirePublishLock(layout, 2000);

      expect(lock.owner.instanceId).toBe(getInstanceId());
      releasePublishLock(lock);
    });

    it("reclaims a lock whose owner file is malformed rather than wedging", async () => {
      // writeJsonExclusive can still be interrupted by a crash, leaving partial
      // JSON. Refusing to act on an unparseable owner would fail every future
      // update for the life of the store.
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      fs.mkdirSync(layout.publishLockDir, { recursive: true });
      fs.writeFileSync(
        path.join(layout.publishLockDir, "owner.json"),
        '{"operationId":"op-0123456789abcdef","non'
      );
      const longAgo = new Date(Date.now() - 10 * 60 * 1000);
      fs.utimesSync(layout.publishLockDir, longAgo, longAgo);

      const lock = await acquirePublishLock(layout, 2000);

      expect(lock.owner.instanceId).toBe(getInstanceId());
      releasePublishLock(lock);
    });

    it("refuses to overwrite an owner file a contender already wrote", () => {
      // The directory creation alone is not the whole claim; the owner write
      // must fail rather than clobber a contender that recreated the directory.
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      fs.mkdirSync(layout.publishLockDir, { recursive: true });
      const ownerPath = path.join(layout.publishLockDir, "owner.json");
      fs.writeFileSync(ownerPath, JSON.stringify(expiredOwner()));

      expect(() => writeJsonExclusive(ownerPath, expiredOwner({ nonce: "f".repeat(32) })))
        .toThrow();
      expect(JSON.parse(fs.readFileSync(ownerPath, "utf8")).nonce).toBe(
        "0123456789abcdef0123456789abcdef"
      );
    });

    it("does not delete a replacement lock while recovering a stale one", async () => {
      // Two processes can decide the same lock is stale. The second must not
      // remove the fresh lock the first already replaced it with, or the new
      // publisher fails its own ownership assertion.
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      writeLockOwner(expiredOwner());

      // First recovery wins and takes the lock.
      const replacement = await acquirePublishLock(layout, 2000);

      // A second process now acts on the stale owner it observed earlier.
      await expect(acquirePublishLock(layout, 300)).rejects.toThrow(
        /Timed out waiting/
      );

      // The replacement still owns the lock and can still publish.
      expect(() => assertLockOwnership(replacement)).not.toThrow();
      releasePublishLock(replacement);
    });

    it.skipIf(!canCreateDirSymlink())(
      "refuses a symlinked publish lock directory",
      async () => {
        // The lock directory is created on demand, so it is not covered by the
        // store's layout checks. Following a symlink here would let stale-lock
        // recovery unlink an owner file outside the managed store.
        const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-lock-"));
        try {
          fs.symlinkSync(outside, layout.publishLockDir, "dir");
          await expect(acquirePublishLock(layout, 300)).rejects.toThrow(
            /symlink/i
          );
        } finally {
          fs.rmSync(outside, { recursive: true, force: true });
        }
      }
    );

    it("aborts a publication whose lock was recovered underneath it", async () => {
      const layout = ensureManagedStoreLayout(getManagedStoreLayout(storeRoot));
      const lock = await acquirePublishLock(layout, 2000);
      // Somebody else recovered and re-took the lock.
      writeLockOwner(expiredOwner({ createdAt: new Date().toISOString() }));

      expect(() => assertLockOwnership(lock)).toThrow(/stolen/);
    });
  });

  describe("stale lease reporting", () => {
    it("warns about an old lease from another instance but never removes it", async () => {
      const daysAgo = (days: number) =>
        new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const current = seedRelease(storeRoot, { version: "2026.08.19" });
      // Enough newer releases that the orphaned one falls outside the rollback
      // window, so only its lease can be keeping it alive.
      const fillers = [
        seedRelease(storeRoot, { version: "2026.07.01", installedAt: daysAgo(10) }),
        seedRelease(storeRoot, { version: "2026.06.01", installedAt: daysAgo(20) }),
      ];
      const orphaned = seedRelease(storeRoot, {
        version: "2026.05.01",
        installedAt: daysAgo(30),
      });
      const layout = getManagedStoreLayout(storeRoot);
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      for (const release of [...fillers, orphaned]) {
        fs.utimesSync(getReleaseDir(layout, release.releaseId), old, old);
      }
      writeCurrentManifest(storeRoot, {
        schemaVersion: 1,
        generation: 1,
        releaseId: current.releaseId,
        previousReleaseId: null,
        publishedAt: new Date().toISOString(),
      });

      // A lease left behind by a backend that crashed two days ago.
      const leaseDir = path.join(layout.leasesDir, orphaned.releaseId);
      fs.mkdirSync(leaseDir, { recursive: true });
      const leaseFile = path.join(leaseDir, "4242-aabbccddeeff-0123456789abcdef.json");
      fs.writeFileSync(
        leaseFile,
        JSON.stringify({
          schemaVersion: 1,
          releaseId: orphaned.releaseId,
          instanceId: "4242-aabbccddeeff",
          pid: 4242,
          operationId: "op-0123456789abcdef",
          createdAt: daysAgo(2),
        })
      );

      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      await collectGarbage();
      const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
      warnSpy.mockRestore();

      // Reported for an operator to act on...
      expect(
        warnings.some(
          (message) =>
            message.includes(orphaned.releaseId) && message.includes("still pinned")
        )
      ).toBe(true);
      // ...but never reclaimed: an orphaned child may still be reading from it.
      expect(fs.existsSync(leaseFile)).toBe(true);
      expect(fs.existsSync(getReleaseDir(layout, orphaned.releaseId))).toBe(true);
    });
  });
});
