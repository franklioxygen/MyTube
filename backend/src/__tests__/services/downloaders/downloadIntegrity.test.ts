import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be declared before any imports that use them
const mockExecFileSafe = vi.fn();
const mockPathExistsSafeSync = vi.fn().mockReturnValue(true);

vi.mock('../../../utils/security', () => ({
  execFileSafe: (...args: unknown[]) => mockExecFileSafe(...args),
  pathExistsSafeSync: (...args: unknown[]) => mockPathExistsSafeSync(...args),
  validateVideoPath: (filePath: string) => filePath,
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  clipsDownloadOutput,
  evaluateMediaCompleteness,
  parseMediaTrackDurations,
  parseSourceDurationSeconds,
  probeMediaTrackDurations,
  verifyDownloadedMediaComplete,
} from '../../../services/downloaders/downloadIntegrity';

const ffprobeJson = (
  format: number | null,
  video: number | null,
  audio: number | null,
) =>
  JSON.stringify({
    streams: [
      ...(video != null
        ? [{ codec_type: 'video', duration: video.toString() }]
        : []),
      ...(audio != null
        ? [{ codec_type: 'audio', duration: audio.toString() }]
        : []),
    ],
    format: format != null ? { duration: format.toString() } : {},
  });

describe('parseMediaTrackDurations', () => {
  it('reads the container and per-track durations', () => {
    expect(parseMediaTrackDurations(ffprobeJson(685.32, 685.32, 400))).toEqual({
      container: 685.32,
      video: 685.32,
      audio: 400,
    });
  });

  it('returns nulls for tracks that carry no duration (Matroska/WebM)', () => {
    const stdout = JSON.stringify({
      streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
      format: { duration: '703.708' },
    });

    expect(parseMediaTrackDurations(stdout)).toEqual({
      container: 703.708,
      video: null,
      audio: null,
    });
  });

  it('returns nulls rather than throwing on unparsable output', () => {
    expect(parseMediaTrackDurations('not json')).toEqual({
      container: null,
      video: null,
      audio: null,
    });
  });
});

describe('evaluateMediaCompleteness', () => {
  it('accepts a file whose tracks agree and match the source', () => {
    const verdict = evaluateMediaCompleteness(
      { container: 1110.76, video: 1110.72, audio: 1110.76 },
      1110.762,
    );

    expect(verdict.complete).toBe(true);
  });

  it('rejects a file that is materially shorter than the source', () => {
    // Real case: an 1111s Bilibili video whose streams were both cut short.
    const verdict = evaluateMediaCompleteness(
      { container: 685.32, video: 685.32, audio: 400 },
      1110.762,
    );

    expect(verdict.complete).toBe(false);
    expect(verdict.reason).toContain('685.3s');
    expect(verdict.reason).toContain('1110.8s');
  });

  it('rejects a merge whose audio was truncated even when the container matches the source', () => {
    // Real case: a 2640s video whose video track is complete but whose audio
    // stops at 366s, so the container duration alone looks correct.
    const verdict = evaluateMediaCompleteness(
      { container: 2639.6, video: 2639.6, audio: 366 },
      2640,
    );

    expect(verdict.complete).toBe(false);
    expect(verdict.reason).toContain('truncated');
  });

  it('rejects a merge whose video was truncated', () => {
    const verdict = evaluateMediaCompleteness(
      { container: 655, video: 515.3, audio: 655 },
      739,
    );

    expect(verdict.complete).toBe(false);
  });

  it('tolerates the muxing slack a normal merge leaves between tracks', () => {
    const verdict = evaluateMediaCompleteness(
      { container: 600.5, video: 600.0, audio: 600.5 },
      600,
    );

    expect(verdict.complete).toBe(true);
  });

  it('tolerates a short clip whose tracks differ by less than the floor', () => {
    // 8s drift on a 30s clip is above the 5% ratio but below the 10s floor, so
    // brief videos are not rejected for ordinary container padding.
    const verdict = evaluateMediaCompleteness(
      { container: 30, video: 30, audio: 22 },
      30,
    );

    expect(verdict.complete).toBe(true);
  });

  it('accepts a file that runs longer than the reported source duration', () => {
    const verdict = evaluateMediaCompleteness(
      { container: 1200, video: 1200, audio: 1200 },
      1110.762,
    );

    expect(verdict.complete).toBe(true);
  });

  it('skips the source comparison when the source reports no usable duration', () => {
    const verdict = evaluateMediaCompleteness(
      { container: 42, video: 42, audio: 42 },
      null,
    );

    expect(verdict.complete).toBe(true);
  });

  it('skips the track comparison for an audio-only download', () => {
    const verdict = evaluateMediaCompleteness(
      { container: 600, video: null, audio: 600 },
      600,
    );

    expect(verdict.complete).toBe(true);
  });

  it('accepts an unprobeable file rather than failing the download', () => {
    const verdict = evaluateMediaCompleteness(
      { container: null, video: null, audio: null },
      1110.762,
    );

    expect(verdict.complete).toBe(true);
  });
});

describe('parseSourceDurationSeconds', () => {
  it.each([
    [1110.762, 1110.762],
    ['685', 685],
    [0, null],
    [-5, null],
    [null, null],
    [undefined, null],
    ['', null],
    ['live', null],
  ])('normalizes %o to %o', (input, expected) => {
    expect(parseSourceDurationSeconds(input)).toBe(expected);
  });
});

describe('clipsDownloadOutput', () => {
  it('detects a config that clips the output', () => {
    expect(clipsDownloadOutput({ downloadSections: '*10:00-12:00' })).toBe(true);
  });

  it('ignores an ordinary config', () => {
    expect(clipsDownloadOutput({ format: 'bestvideo+bestaudio' })).toBe(false);
    expect(clipsDownloadOutput(null)).toBe(false);
    expect(clipsDownloadOutput(undefined)).toBe(false);
  });
});

describe('verifyDownloadedMediaComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExistsSafeSync.mockReturnValue(true);
  });

  it('probes the file and reports a truncated download', async () => {
    mockExecFileSafe.mockResolvedValue({
      stdout: ffprobeJson(685.32, 685.32, 400),
    });

    const verdict = await verifyDownloadedMediaComplete('/videos/clip.mp4', {
      sourceDurationSeconds: 1110.762,
    });

    expect(verdict.complete).toBe(false);
    expect(mockExecFileSafe).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining(['/videos/clip.mp4']),
      { timeout: 30_000 },
    );
  });

  it.each([
    { downloadSections: '*0:00-2:00' },
    { sponsorblockRemove: 'sponsor,intro,outro' },
    { removeChapters: 'intro' },
  ])('ignores the source duration when the config clips the output: %o', async (userConfig) => {
    mockExecFileSafe.mockResolvedValue({
      stdout: ffprobeJson(120, 120, 120),
    });

    const verdict = await verifyDownloadedMediaComplete('/videos/clip.mp4', {
      sourceDurationSeconds: 1110.762,
      userConfig,
    });

    expect(verdict.complete).toBe(true);
  });

  it('still checks track disagreement when content removal is configured', async () => {
    mockExecFileSafe.mockResolvedValue({ stdout: ffprobeJson(600, 600, 300) });
    const verdict = await verifyDownloadedMediaComplete('/videos/clip.mp4', {
      sourceDurationSeconds: 1200,
      userConfig: { sponsorblockRemove: 'all' },
    });
    expect(verdict.complete).toBe(false);
    expect(verdict.reason).toContain('video track');
  });

  it('still compares source duration when SponsorBlock only marks chapters', async () => {
    mockExecFileSafe.mockResolvedValue({ stdout: ffprobeJson(600, 600, 600) });
    const verdict = await verifyDownloadedMediaComplete('/videos/clip.mp4', {
      sourceDurationSeconds: 1200,
      userConfig: { sponsorblockMark: 'all' },
    });
    expect(verdict.complete).toBe(false);
  });

  it.each(['ffprobe not found', 'ffprobe timed out'])('accepts the download when %s', async (message) => {
    mockExecFileSafe.mockRejectedValue(new Error(message));

    const verdict = await verifyDownloadedMediaComplete('/videos/clip.mp4', {
      sourceDurationSeconds: 1110.762,
    });

    expect(verdict.complete).toBe(true);
  });
});

describe('probeMediaTrackDurations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExistsSafeSync.mockReturnValue(true);
  });

  it('reports unknown durations when the file is missing', async () => {
    mockPathExistsSafeSync.mockReturnValue(false);

    await expect(probeMediaTrackDurations('/videos/gone.mp4')).resolves.toEqual({
      container: null,
      video: null,
      audio: null,
    });
    expect(mockExecFileSafe).not.toHaveBeenCalled();
  });

  it('reports unknown durations instead of throwing when ffprobe is unavailable', async () => {
    mockExecFileSafe.mockRejectedValue(
      Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' }),
    );

    await expect(probeMediaTrackDurations('/videos/clip.mp4')).resolves.toEqual({
      container: null,
      video: null,
      audio: null,
    });
  });
});
