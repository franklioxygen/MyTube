import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), proxy: vi.fn(), sign: vi.fn(), headers: vi.fn() }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: mocks.get } };
});
vi.mock('../../../services/downloaders/bilibili/bilibiliConfig', () => ({
  resolveProxiedAxiosConfigForUrl: mocks.proxy,
  resolveProxiedAxiosConfig: mocks.proxy,
}));
vi.mock('../../../services/downloaders/bilibili/bilibiliHeaders', () => ({ buildBilibiliApiHeaders: mocks.headers }));
vi.mock('../../../services/downloaders/bilibili/bilibiliWbi', () => ({ buildSignedBilibiliUrl: mocks.sign }));
vi.mock('../../../utils/ytDlpUtils', () => ({ getUserYtDlpConfig: () => ({}) }));

import { searchBilibiliAuthors, AuthorSearchUnavailableError } from '../../../services/downloaders/bilibili/bilibiliAuthorSearch';
import { getBilibiliAuthorId } from '../../../utils/bilibiliAuthor';

const url = 'https://api.bilibili.com/x/web-interface/wbi/search/type?signed';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.proxy.mockReturnValue({ proxy: false });
  mocks.sign.mockResolvedValue(url);
  mocks.headers.mockReturnValue({ Referer: 'https://www.bilibili.com' });
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
    expect(mocks.get).toHaveBeenCalledWith('https://api.bilibili.com/x/web-interface/card', expect.objectContaining({ maxRedirects: 0 }));
    const { default: axios } = await vi.importActual<typeof import('axios')>('axios');
    const [endpoint, config] = mocks.get.mock.calls[0];
    expect(axios.getUri({ ...config, url: endpoint })).toBe('https://api.bilibili.com/x/web-interface/card?mid=123');
  });
  it('keeps URL-like keywords in query parameters and preserves the signed query encoding', async () => {
    const keyword = '极客 湾 + & https://127.0.0.1/private?admin=true#fragment';
    const signedQuery = `keyword=${encodeURIComponent(keyword)}&page=1&page_size=20&search_type=bili_user&w_rid=signature&wts=123`;
    const endpoint = 'https://api.bilibili.com/x/web-interface/wbi/search/type';
    mocks.sign.mockResolvedValue(`${endpoint}?${signedQuery}`);
    mocks.get.mockResolvedValue({ data: { code: 0, data: { numResults: 0 } } });

    await searchBilibiliAuthors(keyword, 1);

    const { default: axios } = await vi.importActual<typeof import('axios')>('axios');
    const [requestEndpoint, config] = mocks.get.mock.calls[0];
    expect(requestEndpoint).toBe(endpoint);
    const requestUrl = axios.getUri({ ...config, url: requestEndpoint });
    expect(requestUrl).toBe(`${endpoint}?${signedQuery}`);
    expect(new URL(requestUrl).searchParams.get('keyword')).toBe(keyword);
    expect(config.maxRedirects).toBe(0);
  });
  it('returns no match for an explicitly missing UID', async () => {
    mocks.get.mockResolvedValue({ data: { code: -404 } });
    expect(await searchBilibiliAuthors('123', 1)).toEqual({ results: [], page: 1, mode: 'uid', hasMore: false });
  });
  it.each([
    { code: 0, data: { v_voucher: 'challenge' } },
    { code: -352 },
    { code: -412 },
  ])('retries cookie-related risk control once anonymously on the same proxy: %j', async (data) => {
    const headers = { Referer: 'https://www.bilibili.com', Cookie: 'stored-cookie' };
    const proxy = { proxy: { host: 'proxy.example', port: 8080 } };
    mocks.headers.mockReturnValue(headers);
    mocks.proxy.mockReturnValue(proxy);
    mocks.get.mockResolvedValueOnce({ data }).mockResolvedValueOnce({ data: { code: 0, data: {
      numPages: 1, result: [{ mid: 25876945, uname: '极客湾Geekerwan' }],
    } } });

    const result = await searchBilibiliAuthors('极客湾', 1);

    expect(result.results[0].authorId).toBe('25876945');
    expect(mocks.get).toHaveBeenCalledTimes(2);
    const [firstEndpoint, firstConfig] = mocks.get.mock.calls[0];
    const [retryEndpoint, retryConfig] = mocks.get.mock.calls[1];
    expect(retryEndpoint).toBe(firstEndpoint);
    expect(firstConfig.headers.Cookie).toBe('stored-cookie');
    expect(retryConfig.headers).toEqual({ Referer: 'https://www.bilibili.com' });
    expect(retryConfig).toEqual({ ...firstConfig, headers: retryConfig.headers });
    expect(retryConfig.proxy).toBe(proxy.proxy);
    expect(retryConfig.maxRedirects).toBe(0);
    expect(headers.Cookie).toBe('stored-cookie');
  });
  it('also handles an HTTP 412 rejection from the cookie-authenticated public API', async () => {
    mocks.headers.mockReturnValue({ Cookie: 'stored-cookie' });
    mocks.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 412, data: {} } })
      .mockResolvedValueOnce({ data: { code: 0, data: { numResults: 0 } } });
    expect((await searchBilibiliAuthors('query', 1)).results).toEqual([]);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get.mock.calls[1][1].headers.Cookie).toBeUndefined();
  });
  it.each([false, true])('keeps persistent risk control as an error and bounds retries (cookie: %s)', async (withCookie) => {
    mocks.headers.mockReturnValue(withCookie ? { Cookie: 'stored-cookie' } : {});
    mocks.get.mockResolvedValue({ data: { code: 0, data: { v_voucher: 'challenge' } } });
    await expect(searchBilibiliAuthors('query', 1)).rejects.toMatchObject({ code: 'AUTHOR_SEARCH_RISK_CONTROLLED' });
    expect(mocks.get).toHaveBeenCalledTimes(withCookie ? 2 : 1);
  });
  it.each([
    new Error('timeout'),
    { isAxiosError: true, response: { status: 500, data: {} } },
  ])('does not retry unrelated transport failures without the configured cookie: %j', async (error) => {
    mocks.headers.mockReturnValue({ Cookie: 'stored-cookie' });
    mocks.get.mockRejectedValue(error);
    await expect(searchBilibiliAuthors('query', 1)).rejects.toMatchObject({ code: 'AUTHOR_SEARCH_UNAVAILABLE' });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('reports a network failure on the anonymous retry as an ordinary failure', async () => {
    mocks.headers.mockReturnValue({ Cookie: 'stored-cookie' });
    mocks.get.mockResolvedValueOnce({ data: { code: 0, data: { v_voucher: 'challenge' } } })
      .mockRejectedValueOnce(new Error('timeout'));
    await expect(searchBilibiliAuthors('query', 1)).rejects.toMatchObject({ code: 'AUTHOR_SEARCH_UNAVAILABLE' });
    expect(mocks.get).toHaveBeenCalledTimes(2);
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
