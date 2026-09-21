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

  it('follows a master playlist to its first variant', async () => {
    // Every variant of one VOD is the same content at a different bitrate, so
    // which one answers does not matter.
    const fetch = fetcher({
      'https://cdn.example/v/playlist.m3u8': MASTER,
      'https://cdn.example/v/360p/video.m3u8': MEDIA,
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/v/playlist.m3u8', fetch),
    ).resolves.toBeCloseTo(24.5);
    expect(fetch).toHaveBeenCalledTimes(2);
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

  it('returns null for a live playlist with no ENDLIST', async () => {
    // Summing what exists so far would undercount, which is the one direction
    // that causes a good download to be rejected.
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
      'https://cdn.example/a.m3u8': MASTER,
      'https://cdn.example/360p/video.m3u8': MASTER,
    });

    await expect(
      resolveM3u8DurationSeconds('https://cdn.example/a.m3u8', fetch),
    ).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
