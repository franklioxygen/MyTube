import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { logger } from '../../../utils/logger';

const mocks = vi.hoisted(() => ({
  execFileSafe: vi.fn(),
  spawn: vi.fn(),
  pathExistsSafeSync: vi.fn(() => true),
}));

vi.mock('child_process', () => ({ spawn: (...a: unknown[]) => mocks.spawn(...a) }));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../utils/security', () => ({
  execFileSafe: (...a: unknown[]) => mocks.execFileSafe(...a),
  pathExistsSafeSync: (...a: unknown[]) => mocks.pathExistsSafeSync(...(a as [])),
  validateVideoPath: (p: string) => p,
}));

import {
  createGapFinder,
  describeSkippedFragments,
  findTimelineGaps,
  parseFrameShortfall,
  summarizeTimelineGaps,
} from '../../../services/downloaders/timelineGaps';

// Header shapes taken from the production scan, with numbers that reproduce the
// measured results exactly.
const header = (streams: object[]) => JSON.stringify({ streams });
const video = (frames: number, rate: string, duration: number) => ({
  codec_type: 'video', codec_name: 'h264', nb_frames: String(frames),
  r_frame_rate: rate, duration: String(duration), disposition: { attached_pic: 0 },
});
const aac = (frames: number, duration: number, sampleRate = 48000) => ({
  codec_type: 'audio', codec_name: 'aac', nb_frames: String(frames),
  sample_rate: String(sampleRate), duration: String(duration), disposition: { attached_pic: 0 },
});

describe('parseFrameShortfall', () => {
  it('reports no shortfall for a complete file', () => {
    // 236251 frames at 30fps is 7875.033s; 369144 AAC frames is 7875.072s.
    const result = parseFrameShortfall(header([
      video(236251, '30/1', 7875.033333), aac(369144, 7875.072),
    ]));

    expect(result.video).toBeCloseTo(0, 2);
    expect(result.audio).toBeCloseTo(0, 2);
  });

  it('measures a dropped video segment', () => {
    // One 4-second segment missing from the video.
    const result = parseFrameShortfall(header([video(210994, '30/1', 7037.133333)]));

    expect(result.video).toBeCloseTo(4.0, 1);
  });

  it('measures a dropped audio segment, at 44.1kHz', () => {
    // 307591 AAC frames at 44.1kHz account for 7142.25s of a
    // 7146.24s stream - one segment missing.
    const result = parseFrameShortfall(header([aac(307591, 7146.242902, 44100)]));

    expect(result.audio).toBeCloseTo(3.99, 1);
  });

  it('uses the nominal frame rate, not the derived average', () => {
    // avg_frame_rate would be frames/duration, which hides the discrepancy.
    const stream = { ...video(210994, '30/1', 7037.133333), avg_frame_rate: '210994/7037' };

    expect(parseFrameShortfall(header([stream])).video).toBeCloseTo(4.0, 1);
  });

  it('handles an NTSC-style rational frame rate', () => {
    // One segment missing at 29.97fps.
    const result = parseFrameShortfall(header([video(218664, '30000/1001', 7300.059433)]));

    expect(result.video).toBeCloseTo(3.97, 1);
  });

  it('ignores embedded cover art', () => {
    const cover = { ...video(1, '90000/1', 7875), disposition: { attached_pic: 1 } };

    expect(parseFrameShortfall(header([cover, aac(369144, 7875.072)])).video).toBeNull();
  });

  it('leaves non-AAC audio unmeasured, since its frame size is not fixed', () => {
    const opus = { ...aac(100000, 2000), codec_name: 'opus' };

    const result = parseFrameShortfall(header([opus]));
    expect(result.audio).toBeNull();
    expect(result.presentStreams).toEqual(['audio']);
  });

  it.each([
    ['unparseable output', 'not json'],
    ['a stream with no frame count', header([{ codec_type: 'video', duration: '60' }])],
    ['a zero frame rate', header([video(100, '0/0', 60)])],
  ])('returns null for %s', (_label, stdout) => {
    expect(parseFrameShortfall(stdout).video).toBeNull();
  });
});

describe('createGapFinder', () => {
  const feed = (steps: number[], start = 0) => {
    const finder = createGapFinder('audio');
    let t = start;
    finder.push(String(t));
    for (const step of steps) { t += step; finder.push(String(t)); }
    return finder.gaps();
  };

  it('finds a single dropped segment', () => {
    const gaps = feed([0.021, 0.021, 4.03, 0.021], 1911.95 - 0.042);

    expect(gaps).toEqual([{ stream: 'audio', atSeconds: 1911.95, gapSeconds: 4.03 }]);
  });

  it('ignores the one-and-two-frame steps some sources are packaged with', () => {
    // One source had ~1900 of these spread evenly across the file, adding up to 44s
    // of frame shortfall, and not one of them is a dropped segment.
    const steps = Array.from({ length: 2000 }, (_, i) => (i % 2 ? 0.0427 : 0.0213));

    expect(feed(steps)).toEqual([]);
  });

  it('reports every jump in a burst', () => {
    // A run of failed fragments in one bad network window.
    const gaps = feed([0.021, 1.15, 0.021, 2.44, 0.021, 5.56, 0.021]);

    expect(gaps.map((g) => g.gapSeconds)).toEqual([1.15, 2.44, 5.56]);
  });

  it('skips lines that are not timestamps', () => {
    const finder = createGapFinder('video');
    for (const line of ['0.0', '', 'N/A', '0.033', '4.066']) finder.push(line);

    expect(finder.gaps()).toEqual([{ stream: 'video', atSeconds: 0.03, gapSeconds: 4.03 }]);
  });

  it('caps how many gaps it keeps', () => {
    expect(feed(Array.from({ length: 200 }, () => 2))).toHaveLength(50);
  });
});

describe('findTimelineGaps', () => {
  /** A fake ffprobe packet scan that emits the given timestamps and exits. */
  const fakeScan = (timestamps: number[], exitCode = 0, stderr = '') => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(timestamps.map(String).join('\n') + '\n'));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode);
    });
    return child;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathExistsSafeSync.mockReturnValue(true);
  });

  it('does not scan a file whose frame counts add up', async () => {
    // The common case, and it must stay cheap: a header read and nothing else.
    mocks.execFileSafe.mockResolvedValue({
      stdout: header([video(236251, '30/1', 7875.033333), aac(369144, 7875.072)]),
    });

    const result = await findTimelineGaps('/videos/a.mp4');

    expect(result).toEqual({ gaps: [], scannedStreams: [], complete: true });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('treats attached cover art as absent, not an unchecked video stream', async () => {
    const cover = { ...video(1, '90000/1', 60), disposition: { attached_pic: 1 } };
    mocks.execFileSafe.mockResolvedValue({ stdout: header([cover, aac(2813, 60.010667)]) });

    expect(await findTimelineGaps('/videos/a.mp4')).toEqual({
      gaps: [], scannedStreams: [], complete: true,
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('scans present video when its frame count is unavailable', async () => {
    const noCount = { ...video(1800, '30/1', 60), nb_frames: 'N/A' };
    mocks.execFileSafe.mockResolvedValue({ stdout: header([noCount, aac(2813, 60.010667)]) });
    mocks.spawn.mockImplementation(() => fakeScan([0, 0.033, 4.066]));

    const result = await findTimelineGaps('/videos/a.mp4');

    expect(result).toMatchObject({ complete: true, scannedStreams: ['video'] });
    expect(result.gaps).toEqual([{ stream: 'video', atSeconds: 0.03, gapSeconds: 4.03 }]);
    expect(mocks.spawn.mock.calls[0][1]).toContain('v:0');
  });

  it('scans present non-AAC audio even though its frame duration is unknown', async () => {
    const opus = { ...aac(100000, 60.010667), codec_name: 'opus' };
    mocks.execFileSafe.mockResolvedValue({ stdout: header([video(1800, '30/1', 60), opus]) });
    mocks.spawn.mockImplementation(() => fakeScan([0, 0.021, 4.042]));

    const result = await findTimelineGaps('/videos/a.mp4');

    expect(result).toMatchObject({ complete: true, scannedStreams: ['audio'] });
    expect(result.gaps).toEqual([{ stream: 'audio', atSeconds: 0.02, gapSeconds: 4.02 }]);
    expect(mocks.spawn.mock.calls[0][1]).toContain('a:0');
  });

  it('scans only the stream that falls short, and reports where the gap is', async () => {
    mocks.execFileSafe.mockResolvedValue({
      stdout: header([video(210994, '30/1', 7037.133333), aac(329865, 7037.098667)]),
    });
    mocks.spawn.mockImplementation(() => fakeScan([1127.853, 1127.887, 1127.92, 1131.953]));

    const result = await findTimelineGaps('/videos/a.mp4');

    expect(result.scannedStreams).toEqual(['video']);
    expect(result.complete).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn.mock.calls[0][1]).toContain('v:0');
    expect(result.gaps).toEqual([{ stream: 'video', atSeconds: 1127.92, gapSeconds: 4.03 }]);
  });

  it('reports nothing when the shortfall comes from packaging, not a jump', async () => {
    // Frame count short by 44s, but the scan finds no step over a few frames.
    mocks.execFileSafe.mockResolvedValue({ stdout: header([aac(363728, 7803.568438)]) });
    mocks.spawn.mockImplementation(() =>
      fakeScan(Array.from({ length: 500 }, (_, i) => i * 0.0427)),
    );

    expect(await findTimelineGaps('/videos/a.mp4')).toMatchObject({ gaps: [], complete: true });
  });

  it('reports nothing when the scan fails, rather than guessing', async () => {
    mocks.execFileSafe.mockResolvedValue({ stdout: header([video(210994, '30/1', 7037.13)]) });
    mocks.spawn.mockImplementation(() => fakeScan([0, 10, 20], 1));

    expect(await findTimelineGaps('/videos/a.mp4')).toMatchObject({ gaps: [], complete: false });
  });

  it('does not call a scan complete when ffprobe returns no usable timestamps', async () => {
    mocks.execFileSafe.mockResolvedValue({ stdout: header([video(210994, '30/1', 7037.13)]) });
    mocks.spawn.mockImplementation(() => fakeScan([]));

    expect(await findTimelineGaps('/videos/a.mp4')).toMatchObject({
      gaps: [], scannedStreams: ['video'], complete: false,
    });
  });

  it('drains noisy ffprobe stderr and keeps only a bounded diagnostic tail', async () => {
    mocks.execFileSafe.mockResolvedValue({ stdout: header([video(210994, '30/1', 7037.13)]) });
    mocks.spawn.mockImplementation(() => fakeScan([0, 10], 1, 'x'.repeat(10000) + 'last error'));

    const result = await findTimelineGaps('/videos/a.mp4');

    expect(result.complete).toBe(false);
    expect(mocks.spawn.mock.results[0].value.stderr.listenerCount('data')).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('exited with code 1'),
      expect.stringMatching(/last error$/),
    );
    const warnings = vi.mocked(logger.warn).mock.calls;
    expect(warnings[warnings.length - 1][1]).toHaveLength(4096);
  });

  it('fails open when ffprobe is unavailable', async () => {
    mocks.execFileSafe.mockRejectedValue(new Error('spawn ffprobe ENOENT'));

    expect(await findTimelineGaps('/videos/a.mp4')).toEqual({ gaps: [], scannedStreams: [], complete: false });
  });
});

describe('summarizeTimelineGaps', () => {
  it('says how much is missing from each stream, and where', () => {
    expect(summarizeTimelineGaps([
      { stream: 'audio', atSeconds: 4476.2, gapSeconds: 4.04 },
      { stream: 'video', atSeconds: 4476.1, gapSeconds: 4.0 },
    ])).toBe(
      '4.0s of video is missing across 1 gap(s), at 1:14:36 (4.0s); ' +
        '4.0s of audio is missing across 1 gap(s), at 1:14:36 (4.0s)',
    );
  });

  it('lists the first five gaps of a burst and counts the rest', () => {
    const burst = Array.from({ length: 8 }, (_, i) => ({
      stream: 'audio' as const, atSeconds: 60 * i, gapSeconds: 2,
    }));

    expect(summarizeTimelineGaps(burst)).toBe(
      '16.0s of audio is missing across 8 gap(s), at 0:00:00 (2.0s), 0:01:00 (2.0s), ' +
        '0:02:00 (2.0s), 0:03:00 (2.0s), 0:04:00 (2.0s) and 3 more',
    );
  });
});

describe('describeSkippedFragments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathExistsSafeSync.mockReturnValue(true);
  });

  it('has nothing to say about a download that skipped nothing', async () => {
    expect(await describeSkippedFragments('/videos/a.mp4', 0)).toBeNull();
    expect(mocks.execFileSafe).not.toHaveBeenCalled();
  });

  it('records where the content is missing', async () => {
    mocks.execFileSafe.mockResolvedValue({ stdout: header([video(210994, '30/1', 7037.133333)]) });
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: vi.fn() });
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('1127.887\n1127.92\n1131.953\n'));
        child.emit('close', 0);
      });
      return child;
    });

    expect(await describeSkippedFragments('/videos/a.mp4', 1)).toEqual({
      kind: 'incomplete_download',
      skippedFragments: 1,
      gaps: [{ stream: 'video', atSeconds: 1127.92, gapSeconds: 4.03 }],
    });
  });

  it('still reports the loss when the gap cannot be located', async () => {
    mocks.execFileSafe.mockRejectedValue(new Error('spawn ffprobe ENOENT'));

    expect(await describeSkippedFragments('/videos/a.mp4', 3)).toEqual({
      kind: 'incomplete_download',
      skippedFragments: 3,
      gaps: [],
    });
  });
});
