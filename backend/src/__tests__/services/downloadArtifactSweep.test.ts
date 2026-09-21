import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getArtifactOwners: vi.fn(() => [] as unknown[]),
  isActiveDownloadTempDir: vi.fn(() => false),
  isOwnedInactiveDownloadTempDir: vi.fn(() => false),
  removeSafe: vi.fn(async () => {}),
  referenced: new Set<string>(),
  tree: new Map<string, Array<{ name: string; dir: boolean }>>(),
  stats: new Map<string, { size: number; mtimeMs: number }>(),
}));

vi.mock('../../config/paths', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, VIDEOS_DIR: '/videos' };
});

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/security', () => ({
  readdirDirentsSafe: async (dir: string) =>
    (mocks.tree.get(dir) ?? []).map((e) => ({
      name: e.name,
      isDirectory: () => e.dir,
      isFile: () => !e.dir,
    })),
  resolveSafeChildPath: (dir: string, child: string) => `${dir}/${child}`,
  statSafeSync: (p: string) => {
    const s = mocks.stats.get(p);
    if (!s) throw new Error(`no stat for ${p}`);
    return s;
  },
  removeSafe: (...args: unknown[]) => mocks.removeSafe(...(args as [])),
}));

vi.mock('../../services/downloadTempDirectories', () => ({
  isActiveDownloadTempDir: (...a: unknown[]) => mocks.isActiveDownloadTempDir(...(a as [])),
  isOwnedInactiveDownloadTempDir: (...a: unknown[]) =>
    mocks.isOwnedInactiveDownloadTempDir(...(a as [])),
}));

vi.mock('../../services/storageService', () => ({
  getArtifactOwners: () => mocks.getArtifactOwners(),
}));

vi.mock('../../services/storageService/artifactReferences', () => ({
  createArtifactReferenceGuard: () => (p: string) => mocks.referenced.has(p),
}));

import {
  DEFAULT_MIN_ARTIFACT_AGE_MS,
  sweepDownloadArtifacts,
} from '../../services/downloadArtifactSweep';

const NOW = 1_800_000_000_000;
const OLD = NOW - DEFAULT_MIN_ARTIFACT_AGE_MS - 86_400_000;
const RECENT = NOW - 60_000;

/** A temp dir name whose embedded timestamp makes it `ageMs` old. */
const tempDirName = (createdAtMs: number) =>
  `temp_${createdAtMs}_8e873439-a7c3-42ab-98ff-86c32bdaa6d3`;

function file(dir: string, name: string, size: number, mtimeMs: number) {
  const entries = mocks.tree.get(dir) ?? [];
  entries.push({ name, dir: false });
  mocks.tree.set(dir, entries);
  mocks.stats.set(`${dir}/${name}`, { size, mtimeMs });
}

function dir(parent: string, name: string) {
  const entries = mocks.tree.get(parent) ?? [];
  entries.push({ name, dir: true });
  mocks.tree.set(parent, entries);
  mocks.tree.set(`${parent}/${name}`, []);
}

const sweep = (over = {}) => sweepDownloadArtifacts({ now: NOW, ...over });
const paths = (r: { candidates: Array<{ absolutePath: string }> }) =>
  r.candidates.map((c) => c.absolutePath).sort();

describe('sweepDownloadArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tree.clear();
    mocks.stats.clear();
    mocks.referenced.clear();
    mocks.tree.set('/videos', []);
    mocks.isActiveDownloadTempDir.mockReturnValue(false);
    mocks.isOwnedInactiveDownloadTempDir.mockReturnValue(false);
  });

  it('is read-only by default', async () => {
    file('/videos', 'a.f137.mp4', 1000, OLD);

    const result = await sweep();

    expect(result.dryRun).toBe(true);
    expect(result.deletedCount).toBe(0);
    expect(mocks.removeSafe).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(1);
    expect(result.totalBytes).toBe(1000);
  });

  it.each(['a.f137.mp4', 'a.f251.webm', 'a.temp.webm', 'a.mp4.part', 'a.mp4.ytdl'])(
    'selects the abandoned artifact %s',
    async (name) => {
      file('/videos', name, 10, OLD);

      expect(paths(await sweep())).toEqual([`/videos/${name}`]);
    },
  );

  it('leaves ordinary library files alone', async () => {
    file('/videos', 'Real.Video-Author-2026.mp4', 999, OLD);
    file('/videos', 'notes.txt', 10, OLD);

    expect(await sweep().then(paths)).toEqual([]);
  });

  it('spares an artifact a library row still references', async () => {
    file('/videos', 'a.f137.mp4', 10, OLD);
    mocks.referenced.add('/videos/a.f137.mp4');

    expect(await sweep().then(paths)).toEqual([]);
  });

  it('spares a recent artifact even when unreferenced', async () => {
    file('/videos', 'a.f137.mp4', 10, RECENT);

    expect(await sweep().then(paths)).toEqual([]);
  });

  it('selects an unmarked temp directory the cleanup endpoint cannot see', async () => {
    // The production case: created before the ownership marker existed, so
    // isOwnedInactiveDownloadTempDir returns false and nothing ever removes it.
    const name = tempDirName(OLD);
    dir('/videos', name);
    file(`/videos/${name}`, 'video.f30077.mp4.part', 136_000_000, OLD);
    file(`/videos/${name}`, 'video.danmaku.xml', 500, OLD);

    const result = await sweep();

    expect(paths(result)).toEqual([`/videos/${name}`]);
    expect(result.candidates[0].kind).toBe('unmarked_temp_directory');
    expect(result.totalBytes).toBe(136_000_500);
  });

  it('never selects a user folder that merely starts with temp_', async () => {
    // The shape of the earlier P1: cleanup removing any directory named temp_*.
    dir('/videos', 'temp_holidays');
    file('/videos/temp_holidays', 'keep.mp4', 500, OLD);

    expect(await sweep().then(paths)).toEqual([]);
  });

  it('spares an unmarked temp directory containing a referenced file', async () => {
    const name = tempDirName(OLD);
    dir('/videos', name);
    file(`/videos/${name}`, 'keep.mp4', 500, OLD);
    mocks.referenced.add(`/videos/${name}/keep.mp4`);

    expect(await sweep().then(paths)).toEqual([]);
  });

  it('spares a temp directory an in-flight download owns', async () => {
    const name = tempDirName(OLD);
    dir('/videos', name);
    file(`/videos/${name}`, 'video.mp4.part', 10, OLD);
    mocks.isActiveDownloadTempDir.mockReturnValue(true);

    expect(await sweep().then(paths)).toEqual([]);
  });

  it('includes abandoned marked temp directories in the startup report', async () => {
    const name = tempDirName(OLD);
    dir('/videos', name);
    file(`/videos/${name}`, 'video.mp4.part', 10, OLD);
    mocks.isOwnedInactiveDownloadTempDir.mockReturnValue(true);

    const result = await sweep();
    expect(paths(result)).toEqual([`/videos/${name}`]);
    expect(result.candidates[0].kind).toBe('marked_temp_directory');
    expect(mocks.removeSafe).not.toHaveBeenCalled();
  });

  it('spares a marked directory containing a referenced file', async () => {
    const name = tempDirName(OLD);
    dir('/videos', name);
    file(`/videos/${name}`, 'keep.mp4', 10, OLD);
    mocks.isOwnedInactiveDownloadTempDir.mockReturnValue(true);
    mocks.referenced.add(`/videos/${name}/keep.mp4`);

    expect(await sweep().then(paths)).toEqual([]);
  });

  it('spares a recent unmarked temp directory', async () => {
    const name = tempDirName(RECENT);
    dir('/videos', name);
    file(`/videos/${name}`, 'video.mp4.part', 10, RECENT);

    expect(await sweep().then(paths)).toEqual([]);
  });

  it('finds artifacts nested in subdirectories', async () => {
    dir('/videos', 'Author');
    file('/videos/Author', 'a.f137.mp4', 10, OLD);

    expect(await sweep().then(paths)).toEqual(['/videos/Author/a.f137.mp4']);
  });

  it('deletes only when explicitly armed', async () => {
    file('/videos', 'a.f137.mp4', 10, OLD);

    const result = await sweep({ dryRun: false });

    expect(result.deletedCount).toBe(1);
    expect(mocks.removeSafe).toHaveBeenCalledExactlyOnceWith('/videos/a.f137.mp4', '/videos');
  });

  it('records a removal failure without aborting the rest', async () => {
    file('/videos', 'a.f137.mp4', 10, OLD);
    file('/videos', 'b.f137.mp4', 10, OLD);
    mocks.removeSafe.mockRejectedValueOnce(new Error('EBUSY'));

    const result = await sweep({ dryRun: false });

    expect(result.deletedCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('EBUSY');
  });

  it('propagates a failed ownership read instead of treating files as unowned', async () => {
    file('/videos', 'a.f137.mp4', 10, OLD);
    mocks.getArtifactOwners.mockImplementation(() => {
      throw new Error('database unavailable');
    });

    await expect(sweep()).rejects.toThrow('database unavailable');
    expect(mocks.removeSafe).not.toHaveBeenCalled();
  });
});
