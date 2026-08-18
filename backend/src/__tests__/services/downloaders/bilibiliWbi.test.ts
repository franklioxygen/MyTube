import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSignedBilibiliUrl,
  fetchWbiKeys,
  getMixinKey,
  resetWbiKeyCache,
  signWbiParams,
} from '../../../services/downloaders/bilibili/bilibiliWbi';

vi.mock('axios');
vi.mock('../../../utils/logger');

// Live keys served by api.bilibili.com/x/web-interface/nav on 2026-08-17. The
// expected mixin key and signature were produced by an independent
// implementation, so these pin the algorithm rather than the current code.
const IMG_KEY = '7cd084941338484aae1ad9425b84077c';
const SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45';
const EXPECTED_MIXIN = 'ea1db124af3c7062474693fa704f4ff8';

describe('bilibiliWbi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWbiKeyCache();
  });

  it('derives the mixin key by the published shuffle table', () => {
    expect(getMixinKey(IMG_KEY, SUB_KEY)).toBe(EXPECTED_MIXIN);
    expect(getMixinKey(IMG_KEY, SUB_KEY)).toHaveLength(32);
  });

  it('signs params in sorted order with a wts stamp', () => {
    const signed = signWbiParams(
      { mid: '946974', pn: 1, ps: 50, order: 'pubdate' },
      { imgKey: IMG_KEY, subKey: SUB_KEY },
      1_700_000_000_000
    );

    expect(signed).toBe(
      'mid=946974&order=pubdate&pn=1&ps=50&wts=1700000000' +
        '&w_rid=9fd71e2936f41b7224b73d63d392281a'
    );
  });

  it('strips the characters Bilibili excludes before hashing', () => {
    const withSpecials = signWbiParams(
      { keyword: "a!b'c(d)e*f" },
      { imgKey: IMG_KEY, subKey: SUB_KEY },
      1_700_000_000_000
    );
    const withoutSpecials = signWbiParams(
      { keyword: 'abcdef' },
      { imgKey: IMG_KEY, subKey: SUB_KEY },
      1_700_000_000_000
    );

    expect(withSpecials).toBe(withoutSpecials);
  });

  it('reads keys from nav even though it answers code -101 when anonymous', async () => {
    (axios.get as any).mockResolvedValue({
      data: {
        code: -101,
        data: {
          wbi_img: {
            img_url: `https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`,
            sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`,
          },
        },
      },
    });

    await expect(fetchWbiKeys({})).resolves.toEqual({
      imgKey: IMG_KEY,
      subKey: SUB_KEY,
    });
  });

  it('caches keys so paginated enumeration does not refetch nav per page', async () => {
    (axios.get as any).mockResolvedValue({
      data: {
        data: {
          wbi_img: {
            img_url: `https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`,
            sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`,
          },
        },
      },
    });

    const urls = await Promise.all([
      buildSignedBilibiliUrl('https://api.bilibili.com/x/space/arc/search', { pn: 1 }, {}),
      buildSignedBilibiliUrl('https://api.bilibili.com/x/space/arc/search', { pn: 2 }, {}),
      buildSignedBilibiliUrl('https://api.bilibili.com/x/space/arc/search', { pn: 3 }, {}),
    ]);

    expect(axios.get).toHaveBeenCalledTimes(1);
    for (const url of urls) {
      expect(url).toMatch(/w_rid=[0-9a-f]{32}/);
      expect(url).toMatch(/wts=\d+/);
    }
  });

  it('falls back to an unsigned query when nav is unreachable', async () => {
    // Unsigned still works from un-challenged IPs, so losing the keys must not
    // abort an enumeration that would otherwise succeed.
    (axios.get as any).mockRejectedValue(new Error('proxy refused'));

    const url = await buildSignedBilibiliUrl(
      'https://api.bilibili.com/x/space/arc/search',
      { mid: '946974', pn: 1 },
      {}
    );

    expect(url).toBe(
      'https://api.bilibili.com/x/space/arc/search?mid=946974&pn=1'
    );
    expect(url).not.toContain('w_rid');
  });
});
