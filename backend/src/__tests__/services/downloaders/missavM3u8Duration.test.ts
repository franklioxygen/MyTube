import { describe, expect, it, vi } from 'vitest';
import { resolveM3u8DurationSeconds } from '../../../services/downloaders/missav/m3u8';

const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
seg0.ts
#EXTINF:10.000,
seg1.ts
#EXTINF:4.500,
seg2.ts
#EXT-X-ENDLIST
`;

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720
720p/video.m3u8
`;

const fetcher = (map: Record<string, string>) =>
  vi.fn(async (url: string) => {
    if (!(url in map)) throw new Error(`unexpected fetch: ${url}`);
    return map[url];
  });

describe('resolveM3u8DurationSeconds', () => {
  it('sums a VOD media playlist', async () => {
    const fetch = fetcher({ 'https://cdn.example/v/video.m3u8': MEDIA });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/v/video.m3u8', fetch),
    ).resolves.toBeCloseTo(24.5);
  });

  it('accepts a multi-variant master when two renditions corroborate each other', async () => {
    const fetch = fetcher({
      'https://cdn.example/v/playlist.m3u8': MASTER,
      'https://cdn.example/v/360p/video.m3u8': MEDIA,
      'https://cdn.example/v/720p/video.m3u8': MEDIA,
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/v/playlist.m3u8', fetch),
    ).resolves.toBeCloseTo(24.5);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('returns the shorter of two corroborating renditions', async () => {
    // Understating the source is the safe direction: the check flags a
    // shortfall only, so it can never cause a false rejection.
    const shorter = MEDIA.replace('#EXTINF:4.500,', '#EXTINF:3.500,');
    const fetch = fetcher({
      'https://cdn.example/v/playlist.m3u8': MASTER,
      'https://cdn.example/v/360p/video.m3u8': MEDIA,
      'https://cdn.example/v/720p/video.m3u8': shorter,
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/v/playlist.m3u8', fetch),
    ).resolves.toBeCloseTo(23.5);
  });

  it('refuses a master whose renditions disagree beyond the tolerance', async () => {
    // 24.5s against 600s is not the same content; nothing here is trustworthy.
    const longer = ['#EXTM3U', '#EXTINF:600.000,', 'x.ts', '#EXT-X-ENDLIST', ''].join('\n');
    const fetch = fetcher({
      'https://cdn.example/v/playlist.m3u8': MASTER,
      'https://cdn.example/v/360p/video.m3u8': MEDIA,
      'https://cdn.example/v/720p/video.m3u8': longer,
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/v/playlist.m3u8', fetch),
    ).resolves.toBeNull();
  });

  it('reads only the first two renditions of a larger master', async () => {
    const threeVariant = `${MASTER}#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/video.m3u8
`;
    const fetch = fetcher({
      'https://cdn.example/v/playlist.m3u8': threeVariant,
      'https://cdn.example/v/360p/video.m3u8': MEDIA,
      'https://cdn.example/v/720p/video.m3u8': MEDIA,
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/v/playlist.m3u8', fetch),
    ).resolves.toBeCloseTo(24.5);
    // The 1080p rendition is never requested; the fetcher would throw if it were.
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('uses the one readable rendition when the other cannot be fetched', async () => {
    // On a CDN that fingerprints TLS only the rendition the browser loaded can
    // be read. Discarding it would disable the check on exactly those hosts.
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('playlist.m3u8')) return MASTER;
      if (url.includes('360p')) return MEDIA;
      throw new Error('403 Forbidden');
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/v/playlist.m3u8', fetch),
    ).resolves.toBeCloseTo(24.5);
  });

  it('still refuses when no rendition is readable', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('playlist.m3u8')) return MASTER;
      throw new Error('403 Forbidden');
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/v/playlist.m3u8', fetch),
    ).resolves.toBeNull();
  });

  it('reads the renditions already in hand first', async () => {
    // Without the ordering hint the 360p rendition is tried first and fails,
    // leaving nothing readable within the two-rendition budget.
    const tried: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      tried.push(url);
      if (url.endsWith('playlist.m3u8')) return `${MASTER}#EXT-X-STREAM-INF:BANDWIDTH=5000000
1080p/video.m3u8
`;
      if (url.includes('1080p')) return MEDIA;
      throw new Error('403 Forbidden');
    });

    await expect(
      resolveM3u8DurationSeconds(
        'https://cdn.example/v/playlist.m3u8',
        fetch,
        new Set(['https://cdn.example/v/1080p/video.m3u8']),
      ),
    ).resolves.toBeCloseTo(24.5);
    expect(tried[1]).toContain('1080p');
  });

  it('follows an unambiguous relative variant URI', async () => {
    const fetch = fetcher({
      'https://cdn.example/v/playlist.m3u8': MASTER.split('#EXT-X-STREAM-INF:BANDWIDTH=2400000')[0],
      'https://cdn.example/v/360p/video.m3u8': MEDIA,
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/v/playlist.m3u8', fetch),
    ).resolves.toBeCloseTo(24.5);
  });

  it('resolves an absolute variant URI', async () => {
    const fetch = fetcher({
      'https://cdn.example/v/playlist.m3u8': `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000
https://other.example/x/video.m3u8
`,
      'https://other.example/x/video.m3u8': MEDIA,
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/v/playlist.m3u8', fetch),
    ).resolves.toBeCloseTo(24.5);
  });

  it('does not guess when a master offers a separate audio rendition', async () => {
    const fetch = fetcher({
      'https://cdn.example/p.m3u8': `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="audio"
video.m3u8
`,
      'https://cdn.example/video.m3u8': MEDIA,
    });

    await expect(resolveM3u8DurationSeconds('https://cdn.example/p.m3u8', fetch)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null for a live playlist with no ENDLIST', async () => {
    // A growing playlist cannot describe the final download duration.
    const live = MEDIA.replace('#EXT-X-ENDLIST\n', '');
    const fetch = fetcher({ 'https://cdn.example/live.m3u8': live });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/live.m3u8', fetch),
    ).resolves.toBeNull();
  });

  it.each([
    ['not a playlist at all', '<html>403</html>'],
    ['a playlist with no segments', '#EXTM3U\n#EXT-X-ENDLIST\n'],
    ['a malformed EXTINF', '#EXTM3U\n#EXTINF:abc,\nseg.ts\n#EXT-X-ENDLIST\n'],
    ['a negative EXTINF', '#EXTM3U\n#EXTINF:-5,\nseg.ts\n#EXT-X-ENDLIST\n'],
    ['an EXTINF with trailing garbage', '#EXTM3U\n#EXTINF:50oops,\nseg.ts\n#EXT-X-ENDLIST\n'],
    ['an ENDLIST mentioned only in a comment', MEDIA.replace('#EXT-X-ENDLIST', '# comment: #EXT-X-ENDLIST')],
    ['a master with no variant URI', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n'],
  ])('returns null for %s', async (_label, body) => {
    const fetch = fetcher({ 'https://cdn.example/p.m3u8': body });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/p.m3u8', fetch),
    ).resolves.toBeNull();
  });

  it('returns null when the fetch fails rather than propagating', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/p.m3u8', fetch),
    ).resolves.toBeNull();
  });

  it('does not chase a master pointing at another master', async () => {
    const fetch = fetcher({
      'https://cdn.example/a.m3u8': MASTER.split('#EXT-X-STREAM-INF:BANDWIDTH=2400000')[0],
      'https://cdn.example/360p/video.m3u8': MASTER,
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/a.m3u8', fetch),
    ).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
