import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), proxy: vi.fn(), sign: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mocks.get } }));
vi.mock('../../../services/downloaders/bilibili/bilibiliConfig', () => ({
  resolveProxiedAxiosConfigForUrl: mocks.proxy,
  resolveProxiedAxiosConfig: mocks.proxy,
}));
vi.mock('../../../services/downloaders/bilibili/bilibiliHeaders', () => ({ buildBilibiliApiHeaders: () => ({ Referer: 'https://www.bilibili.com' }) }));
vi.mock('../../../services/downloaders/bilibili/bilibiliWbi', () => ({ buildSignedBilibiliUrl: mocks.sign }));
vi.mock('../../../utils/ytDlpUtils', () => ({ getUserYtDlpConfig: () => ({}) }));

import { searchBilibiliAuthors, AuthorSearchUnavailableError } from '../../../services/downloaders/bilibili/bilibiliAuthorSearch';
import { getBilibiliAuthorId } from '../../../utils/bilibiliAuthor';

const url = 'https://api.bilibili.com/x/web-interface/wbi/search/type?signed';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.proxy.mockReturnValue({ proxy: false });
  mocks.sign.mockResolvedValue(url);
});

describe('Bilibili author identity', () => {
  it.each(['123', '000123', 'http://space.bilibili.com/123/', 'https://space.bilibili.com/123/video?spm_id_from=search'])('normalizes %s to a UID', (value) => {
    expect(getBilibiliAuthorId(value)).toBe('123');
  });
  it.each(['0', '-1', '123456789012345678901', 'https://space.bilibili.com.evil.test/123', 'https://evil.test/?mid=123', 'https://space.bilibili.com@evil.test/123', 'javascript:alert(1)', 'https://space.bilibili.com/123/lists', 'https://space.bilibili.com:444/123'])('rejects %s', (value) => {
    expect(getBilibiliAuthorId(value)).toBeNull();
  });
});

describe('searchBilibiliAuthors', () => {
  it('returns independent identities for same-name authors, safe avatars and canonical profiles', async () => {
    mocks.get.mockResolvedValue({ data: { code: 0, data: { numPages: 3, result: [
      { mid: 123, uname: '<em>极客湾</em>', upic: '//i2.hdslb.com/a.jpg' },
      { mid: '456', uname: '极客湾', upic: 'javascript:alert(1)' },
      { mid: 123, uname: '极客湾', upic: '//i2.hdslb.com/a.jpg' },
      { mid: 'bad', uname: 'invalid' },
    ] } } });
    const result = await searchBilibiliAuthors('极客湾', 2);
    expect(result).toEqual({ page: 2, mode: 'keyword', hasMore: true, results: [
      { platform: 'bilibili', authorId: '123', displayName: '极客湾', channelUrl: 'https://space.bilibili.com/123', avatarUrl: 'https://i2.hdslb.com/a.jpg' },
      { platform: 'bilibili', authorId: '456', displayName: '极客湾', channelUrl: 'https://space.bilibili.com/456', avatarUrl: '' },
    ] });
    expect(mocks.sign).toHaveBeenCalledWith(expect.any(String), { search_type: 'bili_user', keyword: '极客湾', page: 2, page_size: 20 }, expect.objectContaining({ timeout: 10000, proxy: false }));
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('resolves a profile URL directly without fuzzy search', async () => {
    mocks.get.mockResolvedValue({ data: { code: 0, data: { card: { mid: '123', name: 'Author', face: '//i0.hdslb.com/avatar.jpg' } } } });
    const result = await searchBilibiliAuthors('https://space.bilibili.com/123/video', 1);
    expect(result.mode).toBe('uid');
    expect(result.results[0].authorId).toBe('123');
    expect(result.hasMore).toBe(false);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledWith('https://api.bilibili.com/x/web-interface/card?mid=123', expect.objectContaining({ maxRedirects: 0 }));
  });
  it('returns no match for an explicitly missing UID', async () => {
    mocks.get.mockResolvedValue({ data: { code: -404 } });
    expect(await searchBilibiliAuthors('123', 1)).toEqual({ results: [], page: 1, mode: 'uid', hasMore: false });
  });
  it('returns a real empty page and caps pagination', async () => {
    mocks.get.mockResolvedValue({ data: { code: 0, data: { numResults: 0 } } });
    expect((await searchBilibiliAuthors('empty', 1)).results).toEqual([]);
    mocks.get.mockResolvedValue({ data: { code: 0, data: { numPages: 100, result: [] } } });
    expect((await searchBilibiliAuthors('query', 10)).hasMore).toBe(false);
  });
  it.each([{ code: -352 }, { code: 0, data: {} }, undefined])('does not turn risk control or malformed responses into no results: %j', async (data) => {
    mocks.get.mockResolvedValue({ data });
    await expect(searchBilibiliAuthors('query', 1)).rejects.toBeInstanceOf(AuthorSearchUnavailableError);
  });
  it('does not invent a profile after a malformed or mismatched UID lookup', async () => {
    mocks.get.mockResolvedValue({ data: { code: 0, data: { card: { mid: 456, name: 'Wrong author' } } } });
    await expect(searchBilibiliAuthors('123', 1)).rejects.toBeInstanceOf(AuthorSearchUnavailableError);
  });
  it('fails on network errors and never bypasses an unusable configured proxy', async () => {
    mocks.get.mockRejectedValue(new Error('timeout'));
    await expect(searchBilibiliAuthors('query', 1)).rejects.toBeInstanceOf(AuthorSearchUnavailableError);
    mocks.get.mockClear();
    mocks.proxy.mockReturnValue(null);
    await expect(searchBilibiliAuthors('query', 1)).rejects.toBeInstanceOf(AuthorSearchUnavailableError);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
