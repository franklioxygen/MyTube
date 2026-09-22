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

/** What the browser captured during page load, keyed by URL. */
const captured = (map: Record<string, string>) =>
  vi.fn((url: string) => map[url]);

const PLAYLIST = 'https://cdn.example/v/playlist.m3u8';

describe('resolveM3u8DurationSeconds', () => {
  it('sums a VOD media playlist', () => {
    expect(
      resolveM3u8DurationSeconds(PLAYLIST, captured({ [PLAYLIST]: MEDIA })),
    ).toBeCloseTo(24.5);
  });

  it('issues no requests of its own', () => {
    // Everything it can read was fetched by the browser, so a hostile playlist
    // has nothing to point this code at.
    const lookup = captured({ [PLAYLIST]: MEDIA });

    resolveM3u8DurationSeconds(PLAYLIST, lookup);

    expect(lookup).toHaveBeenCalledExactlyOnceWith(PLAYLIST);
  });

  it('returns null for a playlist the browser never fetched', () => {
    expect(resolveM3u8DurationSeconds(PLAYLIST, captured({}))).toBeNull();
  });

  describe('master playlists', () => {
    it('corroborates two available renditions', () => {
      expect(
        resolveM3u8DurationSeconds(
          PLAYLIST,
          captured({
            [PLAYLIST]: MASTER,
            'https://cdn.example/v/360p/video.m3u8': MEDIA,
            'https://cdn.example/v/720p/video.m3u8': MEDIA,
          }),
        ),
      ).toBeCloseTo(24.5);
    });

    it('returns the shorter of two corroborating renditions', () => {
      // Understating the source is the safe direction: the check flags a
      // shortfall only, so it can never cause a false rejection.
      expect(
        resolveM3u8DurationSeconds(
          PLAYLIST,
          captured({
            [PLAYLIST]: MASTER,
            'https://cdn.example/v/360p/video.m3u8': MEDIA,
            'https://cdn.example/v/720p/video.m3u8': MEDIA.replace('#EXTINF:4.500,', '#EXTINF:3.500,'),
          }),
        ),
      ).toBeCloseTo(23.5);
    });

    it('refuses renditions that disagree beyond the tolerance', () => {
      // 24.5s against 600s is not the same content; nothing here is trustworthy.
      expect(
        resolveM3u8DurationSeconds(
          PLAYLIST,
          captured({
            [PLAYLIST]: MASTER,
            'https://cdn.example/v/360p/video.m3u8': MEDIA,
            'https://cdn.example/v/720p/video.m3u8': '#EXTM3U\n#EXTINF:600.000,\nx.ts\n#EXT-X-ENDLIST\n',
          }),
        ),
      ).toBeNull();
    });

    it('uses the one rendition the browser fetched when it is the only one', () => {
      // The usual case: the player loads the master and the single rendition it
      // selected. Discarding that would leave no duration at all.
      expect(
        resolveM3u8DurationSeconds(
          PLAYLIST,
          captured({
            [PLAYLIST]: MASTER,
            'https://cdn.example/v/720p/video.m3u8': MEDIA,
          }),
        ),
      ).toBeCloseTo(24.5);
    });

    it('returns null when no rendition was captured', () => {
      expect(
        resolveM3u8DurationSeconds(PLAYLIST, captured({ [PLAYLIST]: MASTER })),
      ).toBeNull();
    });

    it('resolves a relative variant against the URL the master redirected to', () => {
      // The body is reachable under the pre-redirect URL - that is what the
      // request listener recorded and what the selector picked - but the
      // variants belong to the directory the master ended up in.
      const original = 'https://cdn.example/original/playlist.m3u8';
      const final = 'https://cdn.example/final/playlist.m3u8';

      expect(
        resolveM3u8DurationSeconds(
          original,
          captured({
            [original]: MASTER,
            [final]: MASTER,
            'https://cdn.example/final/360p/video.m3u8': MEDIA,
            'https://cdn.example/final/720p/video.m3u8': MEDIA,
          }),
          (requested) => (requested === original ? final : undefined),
        ),
      ).toBeCloseTo(24.5);
    });

    it('follows an absolute variant URI', () => {
      expect(
        resolveM3u8DurationSeconds(
          PLAYLIST,
          captured({
            [PLAYLIST]: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://other.example/x/video.m3u8\n',
            'https://other.example/x/video.m3u8': MEDIA,
          }),
        ),
      ).toBeCloseTo(24.5);
    });

    it('refuses a master offering a separate audio rendition', () => {
      // Each variant then covers only part of the muxed result.
      expect(
        resolveM3u8DurationSeconds(
          PLAYLIST,
          captured({
            [PLAYLIST]: `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="audio"
video.m3u8
`,
            'https://cdn.example/v/video.m3u8': MEDIA,
          }),
        ),
      ).toBeNull();
    });

    it('does not chase a master pointing at another master', () => {
      expect(
        resolveM3u8DurationSeconds(
          PLAYLIST,
          captured({
            [PLAYLIST]: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n360p/video.m3u8\n',
            'https://cdn.example/v/360p/video.m3u8': MASTER,
          }),
        ),
      ).toBeNull();
    });
  });

  it('returns null for a live playlist with no ENDLIST', () => {
    // A growing playlist cannot describe the final download duration.
    expect(
      resolveM3u8DurationSeconds(
        PLAYLIST,
        captured({ [PLAYLIST]: MEDIA.replace('#EXT-X-ENDLIST\n', '') }),
      ),
    ).toBeNull();
  });

  it.each([
    ['not a playlist at all', '<html>403</html>'],
    ['a playlist with no segments', '#EXTM3U\n#EXT-X-ENDLIST\n'],
    ['a malformed EXTINF', '#EXTM3U\n#EXTINF:abc,\nseg.ts\n#EXT-X-ENDLIST\n'],
    ['a negative EXTINF', '#EXTM3U\n#EXTINF:-5,\nseg.ts\n#EXT-X-ENDLIST\n'],
    ['an EXTINF with trailing garbage', '#EXTM3U\n#EXTINF:50oops,\nseg.ts\n#EXT-X-ENDLIST\n'],
    ['an ENDLIST mentioned only in a comment', MEDIA.replace('#EXT-X-ENDLIST', '# comment: #EXT-X-ENDLIST')],
    ['a master with no variant URI', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n'],
  ])('returns null for %s', (_label, body) => {
    expect(resolveM3u8DurationSeconds(PLAYLIST, captured({ [PLAYLIST]: body }))).toBeNull();
  });
});
