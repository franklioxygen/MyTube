import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

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
  findTimelineGaps,
  parseFrameShortfall,
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

    expect(parseFrameShortfall(header([opus])).audio).toBeNull();
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
  const fakeScan = (timestamps: number[], exitCode = 0) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(timestamps.map(String).join('\n') + '\n'));
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

    expect(result).toEqual({ gaps: [], scannedStreams: [] });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('scans only the stream that falls short, and reports where the gap is', async () => {
    mocks.execFileSafe.mockResolvedValue({
      stdout: header([video(210994, '30/1', 7037.133333), aac(329865, 7037.098667)]),
    });
    mocks.spawn.mockImplementation(() => fakeScan([1127.853, 1127.887, 1127.92, 1131.953]));

    const result = await findTimelineGaps('/videos/a.mp4');

    expect(result.scannedStreams).toEqual(['video']);
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

    expect((await findTimelineGaps('/videos/a.mp4')).gaps).toEqual([]);
  });

  it('reports nothing when the scan fails, rather than guessing', async () => {
    mocks.execFileSafe.mockResolvedValue({ stdout: header([video(210994, '30/1', 7037.13)]) });
    mocks.spawn.mockImplementation(() => fakeScan([0, 10, 20], 1));

    expect((await findTimelineGaps('/videos/a.mp4')).gaps).toEqual([]);
  });

  it('fails open when ffprobe is unavailable', async () => {
    mocks.execFileSafe.mockRejectedValue(new Error('spawn ffprobe ENOENT'));

    expect(await findTimelineGaps('/videos/a.mp4')).toEqual({ gaps: [], scannedStreams: [] });
  });
});
