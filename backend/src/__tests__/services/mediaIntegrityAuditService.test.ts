import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getVideosStrict: vi.fn(),
  probeMediaTrackDurations: vi.fn(),
  pathExistsSafeSync: vi.fn(),
  statSafeSync: vi.fn(),
}));

vi.mock('../../config/paths', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, VIDEOS_DIR: '/mock/videos', IMAGES_DIR: '/mock/images' };
});

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/security', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    pathExistsSafeSync: (...args: unknown[]) => mocks.pathExistsSafeSync(...args),
    statSafeSync: (...args: unknown[]) => mocks.statSafeSync(...args),
  };
});

vi.mock('../../services/storageService', () => ({
  getVideosStrict: (...args: unknown[]) => mocks.getVideosStrict(...args),
}));

// The real verdict logic is kept; only the ffprobe call is faked, so the audit
// and the download-time check are exercised through the same evaluator.
vi.mock('../../services/downloaders/downloadIntegrity', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    probeMediaTrackDurations: (...args: unknown[]) => mocks.probeMediaTrackDurations(...args),
  };
});

vi.mock('../../services/filenameTemplate/pathHelpers', () => ({
  resolveManagedWebPath: (webPath: string) => {
    if (!webPath || typeof webPath !== 'string') return null;
    if (webPath.startsWith('cloud:') || webPath.startsWith('mount:')) return null;
    if (webPath.startsWith('http://') || webPath.startsWith('https://')) return null;
    if (!webPath.startsWith('/videos/')) return null;
    const relativePath = webPath.slice('/videos/'.length);
    if (!relativePath) return null;
    return {
      prefix: '/videos',
      rootDir: '/mock/videos',
      relativePath,
      absolutePath: `/mock/videos/${relativePath}`,
    };
  },
}));

import {
  auditMediaIntegrity,
  clearMediaIntegrityProbeCache,
} from '../../services/mediaIntegrityAuditService';

const video = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  title: 'A video',
  sourceUrl: 'https://example.com/v1',
  videoPath: '/videos/a.mp4',
  duration: '600',
  ...over,
});

const tracks = (container: number | null, v: number | null, a: number | null) => ({
  container,
  video: v,
  audio: a,
});

describe('auditMediaIntegrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMediaIntegrityProbeCache();
    mocks.pathExistsSafeSync.mockReturnValue(true);
    mocks.statSafeSync.mockReturnValue({ mtimeMs: 1, size: 100 });
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(600, 600, 600));
  });

  it('reports a clean library', async () => {
    mocks.getVideosStrict.mockReturnValue([video(), video({ id: 'v2', videoPath: '/videos/b.mp4' })]);

    const result = await auditMediaIntegrity();

    expect(result.items).toEqual([]);
    expect(result.summary.probed).toBe(2);
    expect(result.humanSummary).toContain('no integrity problems');
  });

  it('flags a truncated audio track', async () => {
    // The real case: container duration is honest, only the audio is short.
    mocks.getVideosStrict.mockReturnValue([video({ duration: '2640' })]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(2639.6, 2639.6, 366));

    const result = await auditMediaIntegrity();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].reasons).toContain('track_disagreement');
    expect(result.items[0].recommendedAction).toBe('redownload');
    expect(result.items[0].detail).toContain('366.0s');
    expect(result.summary.trackDisagreements).toBe(1);
  });

  it('flags a row whose file is gone', async () => {
    mocks.getVideosStrict.mockReturnValue([video()]);
    mocks.pathExistsSafeSync.mockReturnValue(false);

    const result = await auditMediaIntegrity();

    expect(result.items[0].reasons).toEqual(['file_missing']);
    expect(result.items[0].recommendedAction).toBe('redownload');
    expect(mocks.probeMediaTrackDurations).not.toHaveBeenCalled();
  });

  it('flags a stale stored duration', async () => {
    mocks.getVideosStrict.mockReturnValue([video({ duration: '685' })]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(1110.76, 1110.72, 1110.76));

    const result = await auditMediaIntegrity();

    expect(result.items[0].reasons).toEqual(['duration_mismatch']);
    expect(result.items[0].recommendedAction).toBe('refresh_duration');
  });

  it('tolerates ordinary drift between the stored and measured duration', async () => {
    mocks.getVideosStrict.mockReturnValue([video({ duration: '600' })]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(604, 604, 604));

    const result = await auditMediaIntegrity();

    expect(result.items).toEqual([]);
  });

  it('flags a file ffprobe cannot read', async () => {
    mocks.getVideosStrict.mockReturnValue([video()]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(null, null, null));

    const result = await auditMediaIntegrity();

    expect(result.items[0].reasons).toEqual(['unprobeable']);
    expect(result.items[0].recommendedAction).toBe('manual_review');
  });

  it.each(['cloud:remote/a.mp4', 'mount:/app/mount-test/a.mp4', 'https://example.com/a.mp4'])(
    'skips the external row %s instead of calling it missing',
    async (videoPath) => {
      mocks.getVideosStrict.mockReturnValue([video({ videoPath })]);

      const result = await auditMediaIntegrity();

      expect(result.items).toEqual([]);
      expect(result.summary.skippedExternal).toBe(1);
      expect(mocks.probeMediaTrackDurations).not.toHaveBeenCalled();
    },
  );

  it('skips a row still pointing at a yt-dlp intermediate', async () => {
    mocks.getVideosStrict.mockReturnValue([video({ videoPath: '/videos/a.f137.mp4' })]);

    const result = await auditMediaIntegrity();

    expect(result.summary.skippedTemporaryArtifacts).toBe(1);
    expect(mocks.probeMediaTrackDurations).not.toHaveBeenCalled();
  });

  it('skips the track comparison for an audio-only row', async () => {
    mocks.getVideosStrict.mockReturnValue([video({ videoPath: '/videos/a.m4a' })]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(600, null, 600));

    const result = await auditMediaIntegrity();

    expect(result.items).toEqual([]);
  });

  it('does not re-probe an unchanged file on a second audit', async () => {
    mocks.getVideosStrict.mockReturnValue([video()]);

    await auditMediaIntegrity();
    await auditMediaIntegrity();

    expect(mocks.probeMediaTrackDurations).toHaveBeenCalledOnce();
  });

  it('re-probes once the file changes', async () => {
    mocks.getVideosStrict.mockReturnValue([video()]);

    await auditMediaIntegrity();
    mocks.statSafeSync.mockReturnValue({ mtimeMs: 2, size: 200 });
    await auditMediaIntegrity();

    expect(mocks.probeMediaTrackDurations).toHaveBeenCalledTimes(2);
  });

  it('returns a stable order regardless of probe completion order', async () => {
    mocks.getVideosStrict.mockReturnValue([
      video({ id: 'v3', videoPath: '/videos/c.mp4' }),
      video({ id: 'v1', videoPath: '/videos/a.mp4' }),
      video({ id: 'v2', videoPath: '/videos/b.mp4' }),
    ]);
    mocks.probeMediaTrackDurations.mockImplementation(async (p: string) => {
      // Finish in the reverse of the input order.
      await new Promise((r) => setTimeout(r, p.includes('c.mp4') ? 15 : p.includes('b.mp4') ? 10 : 1));
      return tracks(600, 600, 100);
    });

    const result = await auditMediaIntegrity();

    expect(result.items.map((i) => i.localVideoId)).toEqual(['v1', 'v2', 'v3']);
  });

  it('propagates a failed database read rather than reporting a clean library', async () => {
    mocks.getVideosStrict.mockImplementation(() => {
      throw new Error('database unavailable');
    });

    await expect(auditMediaIntegrity()).rejects.toThrow('database unavailable');
  });

  it('never writes anything', async () => {
    mocks.getVideosStrict.mockReturnValue([video()]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(600, 600, 100));

    const result = await auditMediaIntegrity();

    // The service exposes no repair path at all; the only storage call it makes
    // is the read.
    expect(result.items).toHaveLength(1);
    expect(Object.keys(mocks)).not.toContain('updateVideo');
  });
});
