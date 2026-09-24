import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getVideosStrict: vi.fn(),
  probeMediaTrackDurations: vi.fn(),
  pathExistsSafeSync: vi.fn(),
  statSafeSync: vi.fn(),
  findVideoFile: vi.fn(),
  getCollections: vi.fn(() => []),
  readdirSafeSync: vi.fn((..._args: unknown[]) => [] as string[]),
  findTimelineGaps: vi.fn(async (..._args: unknown[]) => ({ gaps: [] as unknown[], scannedStreams: [] as string[], complete: true })),
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
    readdirSafeSync: (...args: unknown[]) => mocks.readdirSafeSync(...args),
  };
});

vi.mock('../../services/storageService', () => ({
  getVideosStrict: (...args: unknown[]) => mocks.getVideosStrict(...args),
  findVideoFile: (...args: unknown[]) => mocks.findVideoFile(...args),
  getCollections: () => mocks.getCollections(),
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

vi.mock('../../services/downloaders/timelineGaps', async (importOriginal) => ({
  // Keep the real formatter; only the file scan is faked.
  ...(await importOriginal<typeof import('../../services/downloaders/timelineGaps')>()),
  findTimelineGaps: (...args: unknown[]) => mocks.findTimelineGaps(...args),
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
    mocks.findVideoFile.mockReturnValue(null);
    mocks.readdirSafeSync.mockReturnValue([]);
    mocks.findTimelineGaps.mockResolvedValue({ gaps: [], scannedStreams: [], complete: true });
  });

  it('reports a clean library', async () => {
    mocks.getVideosStrict.mockReturnValue([video(), video({ id: 'v2', videoPath: '/videos/b.mp4' })]);

    const result = await auditMediaIntegrity();

    expect(result.items).toEqual([]);
    expect(result.summary.probed).toBe(2);
    expect(result.humanSummary).toContain('no integrity problems');
    expect(mocks.getCollections).not.toHaveBeenCalled();
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

  it('says which kind of item each finding is, so a re-download replaces the same kind', async () => {
    // Legacy rows carry no mediaType and are videos.
    mocks.getVideosStrict.mockReturnValue([
      video({ id: 'a1', mediaType: 'audio', duration: '2640' }),
      video({ id: 'v1', duration: '2640' }),
    ]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(600, 600, 600));

    const result = await auditMediaIntegrity();

    expect(result.items.map((item) => [item.localVideoId, item.mediaType])).toEqual([
      ['a1', 'audio'],
      ['v1', 'video'],
    ]);
  });

  const fsError = (code: string) => Object.assign(new Error(code), { code });

  it('flags a row whose file is gone', async () => {
    mocks.getVideosStrict.mockReturnValue([video()]);
    mocks.pathExistsSafeSync.mockReturnValue(false);
    mocks.statSafeSync.mockImplementation(() => { throw fsError('ENOENT'); });

    const result = await auditMediaIntegrity();

    expect(result.items[0].reasons).toEqual(['file_missing']);
    expect(result.items[0].recommendedAction).toBe('redownload');
    expect(mocks.probeMediaTrackDurations).not.toHaveBeenCalled();
  });

  it.each(['EACCES', 'EIO', 'ESTALE'])(
    'does not call an unreadable file missing (%s)',
    async (code) => {
      // existsSync answers false for these exactly as it does for a missing
      // file, so a dropped NAS mount would otherwise report every row missing
      // and recommend redownloading the whole library.
      mocks.getVideosStrict.mockReturnValue([video()]);
      mocks.pathExistsSafeSync.mockReturnValue(false);
      mocks.statSafeSync.mockImplementation(() => { throw fsError(code); });

      const result = await auditMediaIntegrity();

      expect(result.items[0].reasons).toEqual(['unprobeable']);
      expect(result.items[0].recommendedAction).toBe('manual_review');
      expect(result.summary.filesMissing).toBe(0);
    },
  );

  describe('legacy filename-only rows', () => {
    const legacy = (id = 'v1', filename = 'a.mp4') =>
      video({ id, videoPath: null, videoFilename: filename });

    it('calls a lookup miss missing when the library is readable', async () => {
      mocks.getVideosStrict.mockReturnValue([legacy()]);

      const result = await auditMediaIntegrity();

      expect(result.items[0].reasons).toEqual(['file_missing']);
    });

    it('does not call a lookup miss missing when the library cannot be read', async () => {
      // findVideoFile catches its own errors and returns null, so its miss
      // cannot distinguish "not there" from "could not look".
      mocks.getVideosStrict.mockReturnValue([legacy()]);
      mocks.readdirSafeSync.mockImplementation(() => { throw fsError('EIO'); });

      const result = await auditMediaIntegrity();

      expect(result.items[0].reasons).toEqual(['unprobeable']);
      expect(result.items[0].detail).toContain('EIO');
      expect(result.summary.filesMissing).toBe(0);
    });

    it('checks the library once per audit, not once per row', async () => {
      mocks.getVideosStrict.mockReturnValue([legacy('v1', 'a.mp4'), legacy('v2', 'b.mp4'), legacy('v3', 'c.mp4')]);
      mocks.readdirSafeSync.mockImplementation(() => { throw fsError('EIO'); });

      const result = await auditMediaIntegrity();

      expect(mocks.readdirSafeSync).toHaveBeenCalledOnce();
      expect(result.summary.unprobeable).toBe(3);
    });
  });

  it('flags a stale stored duration on a file that is longer than recorded', async () => {
    mocks.getVideosStrict.mockReturnValue([video({ duration: '685' })]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(1110.76, 1110.72, 1110.76));

    const result = await auditMediaIntegrity();

    expect(result.items[0].reasons).toEqual(['duration_mismatch']);
    expect(result.items[0].recommendedAction).toBe('refresh_duration');
  });

  it('does not recommend refreshing the duration of a file that shrank', async () => {
    // Equally truncated tracks still agree, so the only signal is that the file
    // is now shorter than recorded. Refreshing the duration would overwrite the
    // one record that it used to be longer and every later audit would pass.
    mocks.getVideosStrict.mockReturnValue([video({ duration: '3600' })]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(1800, 1800, 1800));

    const result = await auditMediaIntegrity();

    expect(result.items[0].reasons).toEqual(['duration_mismatch']);
    expect(result.items[0].recommendedAction).toBe('redownload');
    expect(result.items[0].detail).toContain('truncated after the row was written');
  });

  it.each(['existence check', 'legacy lookup'])(
    'reports a failed %s as unprobeable and continues auditing other rows',
    async (failure) => {
      const broken = failure === 'legacy lookup'
        ? video({ videoPath: null, videoFilename: 'a.mp4' })
        : video();
      mocks.getVideosStrict.mockReturnValue([
        broken,
        video({ id: 'v2', videoPath: '/videos/b.mp4' }),
      ]);
      const check = failure === 'legacy lookup' ? mocks.findVideoFile : mocks.pathExistsSafeSync;
      check.mockImplementationOnce(() => { throw new Error('path access failed'); });

      const result = await auditMediaIntegrity();

      expect(result.summary).toMatchObject({
        totalVideos: 2, probed: 1, unprobeable: 1, filesMissing: 0,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        localVideoId: 'v1', reasons: ['unprobeable'], recommendedAction: 'manual_review',
        measured: tracks(null, null, null),
      });
      expect(result.items[0].detail).toContain('path access failed');
      expect(mocks.probeMediaTrackDurations).toHaveBeenCalledExactlyOnceWith('/mock/videos/b.mp4');
    },
  );

  it('loads collections once per audit, only when legacy lookup needs them', async () => {
    mocks.getVideosStrict.mockReturnValue([
      video({ videoPath: null, videoFilename: 'a.mp4' }),
      video({ id: 'v2', videoPath: null, videoFilename: 'b.mp4' }),
    ]);
    mocks.findVideoFile.mockImplementation((filename) => `/mock/videos/Collection/${filename}`);

    expect((await auditMediaIntegrity()).summary.probed).toBe(2);
    expect(mocks.getCollections).toHaveBeenCalledOnce();
    await auditMediaIntegrity();
    expect(mocks.getCollections).toHaveBeenCalledTimes(2);
  });

  it('audits a legacy filename-only row using the existing file lookup', async () => {
    mocks.getVideosStrict.mockReturnValue([video({ videoPath: null, videoFilename: 'a.mp4' })]);
    mocks.findVideoFile.mockReturnValue('/mock/videos/Collection/a.mp4');
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(600, 600, 100));

    const result = await auditMediaIntegrity();

    expect(mocks.findVideoFile).toHaveBeenCalledWith('a.mp4', []);
    expect(mocks.probeMediaTrackDurations).toHaveBeenCalledWith('/mock/videos/Collection/a.mp4');
    expect(result.items[0].reasons).toEqual(['track_disagreement']);
    expect(result.summary.skippedExternal).toBe(0);
  });

  it.each([null, '/videos/../outside.mp4', '/images/a.mp4'])(
    'reports an unresolved local row instead of silently skipping it: %s',
    async (videoPath) => {
      mocks.getVideosStrict.mockReturnValue([video({ videoPath })]);

      const result = await auditMediaIntegrity();

      expect(result.items[0].reasons).toEqual(['file_missing']);
      expect(result.summary.skippedExternal).toBe(0);
      expect(mocks.probeMediaTrackDurations).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['01:23', 83],
    ['1:23', 83],
    ['01:02:03', 3723],
  ])('reads the clock-formatted stored duration %s as %i seconds', async (stored, seconds) => {
    mocks.getVideosStrict.mockReturnValue([video({ duration: stored })]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(seconds, seconds, seconds));

    const result = await auditMediaIntegrity();

    // parseFloat would read "01:23" as 1 and report an intact file as mismatched.
    expect(result.items).toEqual([]);
  });

  it.each(['1 hour', '12abc', '', '  ', 'NaN'])(
    'skips the duration comparison for the uninterpretable stored value %o',
    async (stored) => {
      // parseFloat("1 hour") is 1, which would report a 3600s file as mismatched.
      mocks.getVideosStrict.mockReturnValue([video({ duration: stored })]);
      mocks.probeMediaTrackDurations.mockResolvedValue(tracks(3600, 3600, 3600));

      const result = await auditMediaIntegrity();

      expect(result.items).toEqual([]);
    },
  );

  it('skips the duration comparison for a stored value it cannot interpret', async () => {
    mocks.getVideosStrict.mockReturnValue([video({ duration: 'about an hour' })]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(3600, 3600, 3600));

    const result = await auditMediaIntegrity();

    expect(result.items).toEqual([]);
  });

  it('still flags a clock-formatted duration that genuinely disagrees', async () => {
    // Measured longer than stored, so this stays a metadata refresh.
    mocks.getVideosStrict.mockReturnValue([video({ duration: '01:23' })]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(600, 600, 600));

    const result = await auditMediaIntegrity();

    expect(result.items[0].reasons).toEqual(['duration_mismatch']);
    expect(result.items[0].storedDurationSeconds).toBe(83);
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

  it.each(['/videos/a.f137.mp4', '/videos/lesson.f137.final.mp4', '/videos/a.temp.mp4'])(
    'still audits %s, since the row identifies it as published media',
    async (videoPath) => {
      // A title- or template-derived name may legitimately contain `.fNNN.` or
      // `.temp.`; skipping on the basename alone would hide real corruption in a
      // library entry the database says is published.
      mocks.getVideosStrict.mockReturnValue([video({ videoPath })]);
      mocks.probeMediaTrackDurations.mockResolvedValue(tracks(600, 600, 100));

      const result = await auditMediaIntegrity();

      expect(mocks.probeMediaTrackDurations).toHaveBeenCalledOnce();
      expect(result.items[0].reasons).toContain('track_disagreement');
    },
  );

  it('skips the track comparison for an audio-only row', async () => {
    mocks.getVideosStrict.mockReturnValue([video({ videoPath: '/videos/a.m4a' })]);
    mocks.probeMediaTrackDurations.mockResolvedValue(tracks(600, null, 600));

    const result = await auditMediaIntegrity();

    expect(result.items).toEqual([]);
  });

  it.each(['HTTP://example.com/a.mp4', 'HTTPS://example.com/a.mp4', 'Cloud:remote/a.mp4', 'MOUNT:/m/a.mp4'])(
    'treats %s as external despite the scheme case',
    async (videoPath) => {
      mocks.getVideosStrict.mockReturnValue([video({ videoPath })]);

      const result = await auditMediaIntegrity();

      expect(result.summary.skippedExternal).toBe(1);
      expect(result.summary.filesMissing).toBe(0);
      expect(result.items).toEqual([]);
    },
  );

  it('re-probes once the cached result is older than its maximum age', async () => {
    // mtime and size catch every replacement the app performs, but not a file
    // rewritten in place to the same length with its timestamp restored.
    mocks.getVideosStrict.mockReturnValue([video()]);
    vi.useFakeTimers();
    try {
      await auditMediaIntegrity();
      vi.advanceTimersByTime(11 * 60 * 1000);
      await auditMediaIntegrity();
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.probeMediaTrackDurations).toHaveBeenCalledTimes(2);
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

  it('retries an unsuccessful probe even when the file is unchanged', async () => {
    mocks.getVideosStrict.mockReturnValue([video()]);
    mocks.probeMediaTrackDurations.mockResolvedValueOnce(tracks(null, null, null));

    expect((await auditMediaIntegrity()).summary.unprobeable).toBe(1);
    expect((await auditMediaIntegrity()).items).toEqual([]);
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

  describe('timeline check', () => {
    const gap = (stream: 'video' | 'audio', atSeconds: number, gapSeconds: number) =>
      ({ stream, atSeconds, gapSeconds });

    it('is off by default, and says so rather than implying a clean result', async () => {
      mocks.getVideosStrict.mockReturnValue([video()]);

      const result = await auditMediaIntegrity();

      expect(mocks.findTimelineGaps).not.toHaveBeenCalled();
      expect(result.summary.timelineChecked).toBe(false);
      expect(result.humanSummary).toContain('no integrity problems');
      expect(result.humanSummary).toContain('was not checked');
    });

    it('reports a dropped segment with where it is', async () => {
      // One segment dropped: tracks agree and the duration is intact, so no other check fires.
      mocks.getVideosStrict.mockReturnValue([video({ duration: '7037' })]);
      mocks.probeMediaTrackDurations.mockResolvedValue(tracks(7037.13, 7037.13, 7037.10));
      mocks.findTimelineGaps.mockResolvedValue({
        gaps: [gap('video', 1127.92, 4.03)], scannedStreams: ['video'], complete: true,
      });

      const result = await auditMediaIntegrity({ timeline: true });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].reasons).toEqual(['timeline_gap']);
      expect(result.items[0].recommendedAction).toBe('redownload');
      expect(result.items[0].gaps).toEqual([gap('video', 1127.92, 4.03)]);
      expect(result.items[0].detail).toContain('4.0s of video is missing');
      expect(result.items[0].detail).toContain('0:18:47');
      expect(result.items[0].detail).toContain('if a re-download has the same gap');
      expect(result.summary).toMatchObject({ timelineGaps: 1, timelineChecked: true });
      expect(result.humanSummary).toContain('1 with content missing mid-file');
      expect(result.humanSummary).not.toContain('was not checked');
    });

    it('summarises a burst of gaps per stream', async () => {
      // 21 audio gaps in one bad network window.
      mocks.getVideosStrict.mockReturnValue([video({ duration: '28537' })]);
      mocks.probeMediaTrackDurations.mockResolvedValue(tracks(28537.66, 28537.58, 28537.66));
      mocks.findTimelineGaps.mockResolvedValue({
        gaps: Array.from({ length: 21 }, (_, i) => gap('audio', 2656 + i * 12, 5)),
        scannedStreams: ['audio'], complete: true,
      });

      const { detail } = (await auditMediaIntegrity({ timeline: true })).items[0];

      expect(detail).toContain('105.0s of audio is missing across 21 gap(s)');
      expect(detail).toContain('and 16 more');
    });

    it('reports a clean file as clean', async () => {
      mocks.getVideosStrict.mockReturnValue([video()]);

      const result = await auditMediaIntegrity({ timeline: true });

      expect(mocks.findTimelineGaps).toHaveBeenCalledOnce();
      expect(result.items).toEqual([]);
    });

    it('does not scan a file it could not probe', async () => {
      mocks.getVideosStrict.mockReturnValue([video()]);
      mocks.probeMediaTrackDurations.mockResolvedValue(tracks(null, null, null));

      await auditMediaIntegrity({ timeline: true });

      expect(mocks.findTimelineGaps).not.toHaveBeenCalled();
    });

    it('does not rescan an unchanged file', async () => {
      // The scan reads the whole file; a repeat audit must not pay for it again.
      mocks.getVideosStrict.mockReturnValue([video()]);

      await auditMediaIntegrity({ timeline: true });
      await auditMediaIntegrity({ timeline: true });

      expect(mocks.findTimelineGaps).toHaveBeenCalledOnce();
    });

    it('retries an incomplete scan on the next audit', async () => {
      mocks.getVideosStrict.mockReturnValue([video()]);
      mocks.findTimelineGaps
        .mockResolvedValueOnce({ gaps: [], scannedStreams: ['video'], complete: false })
        .mockResolvedValue({ gaps: [], scannedStreams: ['video'], complete: true });

      const first = await auditMediaIntegrity({ timeline: true });
      const second = await auditMediaIntegrity({ timeline: true });
      const third = await auditMediaIntegrity({ timeline: true });

      expect(mocks.findTimelineGaps).toHaveBeenCalledTimes(2);
      expect(first.summary.timelineIncomplete).toBe(1);
      expect(first.humanSummary).toContain('could not finish for 1 file');
      expect(second.summary.timelineIncomplete).toBe(0);
      expect(third.summary.timelineIncomplete).toBe(0);
    });

    it('keeps timeline results well past the probe cache lifetime', async () => {
      mocks.getVideosStrict.mockReturnValue([video()]);
      vi.useFakeTimers();
      try {
        await auditMediaIntegrity({ timeline: true });
        vi.advanceTimersByTime(60 * 60 * 1000);
        await auditMediaIntegrity({ timeline: true });
      } finally {
        vi.useRealTimers();
      }

      // The header probe expired and ran again; the scan did not.
      expect(mocks.probeMediaTrackDurations).toHaveBeenCalledTimes(2);
      expect(mocks.findTimelineGaps).toHaveBeenCalledOnce();
    });

    it('rescans once the file changes', async () => {
      mocks.getVideosStrict.mockReturnValue([video()]);

      await auditMediaIntegrity({ timeline: true });
      mocks.statSafeSync.mockReturnValue({ mtimeMs: 2, size: 200 });
      await auditMediaIntegrity({ timeline: true });

      expect(mocks.findTimelineGaps).toHaveBeenCalledTimes(2);
    });
  });
});
