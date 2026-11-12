import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAuthorSourceAvatar } from '../../services/authorAvatarFetchService';
import { collectAvatarSources, normalizeAvatarSource } from '../../utils/authorAvatarSources';

const state = vi.hoisted(() => ({ spawn: vi.fn(), config: vi.fn(), proxy: vi.fn(), get: vi.fn(), bili: vi.fn(), twitch: vi.fn() }));
vi.mock('../../utils/ytDlpUtils', () => ({ executeYtDlpSpawn: state.spawn, getUserYtDlpConfig: state.config, getNetworkConfigFromUserConfig: (c: unknown) => c, getAxiosProxyConfig: state.proxy }));
vi.mock('../../utils/publicAxios', () => ({ publicAxiosGet: state.get }));
vi.mock('../../services/downloaders/bilibili/bilibiliAuthorSearch', () => ({ searchBilibiliAuthors: state.bili }));
vi.mock('../../services/twitchService', () => ({ twitchApiService: { getChannelByLogin: state.twitch } }));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64');
function processResult(info: unknown) {
  const stdout = new PassThrough(), stderr = new PassThrough();
  const completion = Promise.resolve().then(() => { stdout.end(JSON.stringify(info)); stderr.end(); });
  return { stdout, stderr, kill: vi.fn(), then: completion.then.bind(completion) };
}
function pendingProcess() {
  let close!: () => void;
  const completion = new Promise<void>(resolve => { close = resolve; });
  return { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), then: completion.then.bind(completion), close };
}
beforeEach(() => {
  vi.clearAllMocks(); state.config.mockReturnValue({ proxy: '' }); state.proxy.mockReturnValue({ proxy: false });
  state.get.mockResolvedValue({ data: png });
});
afterEach(() => vi.useRealTimers());
describe('author avatar source lookup', () => {
  it('normalizes supported channel routes and rejects arbitrary URLs', () => {
    expect(normalizeAvatarSource('https://m.youtube.com/@test/about?x=y')).toEqual({ platform: 'youtube', channelUrl: 'https://www.youtube.com/@test' });
    expect(normalizeAvatarSource('https://www.twitch.tv/SomeUser/videos')?.channelUrl).toBe('https://www.twitch.tv/someuser');
    expect(collectAvatarSources(['https://space.bilibili.com/00123', 'https://space.bilibili.com/123'])).toHaveLength(1);
    for (const url of ['https://youtube.com.evil.test/@x', 'https://youtube.com/watch?v=123', 'http://127.0.0.1', 'file:///tmp/image', 'https://user:pass@youtube.com/@x', 'https://youtube.com:444/@x']) expect(normalizeAvatarSource(url)).toBeNull();
  });
  it('selects YouTube avatar metadata instead of the channel banner and honors explicit direct proxy policy', async () => {
    state.spawn.mockReturnValue(processResult({ thumbnails: [{ id: 'banner_uncropped', url: 'https://images.test/banner' }, { id: 'avatar_uncropped', url: 'https://images.test/avatar' }] }));
    const result = await fetchAuthorSourceAvatar({ platform: 'youtube', channelUrl: 'https://www.youtube.com/@test' });
    expect(result).toEqual({ buffer: png, mime: 'image/png' });
    expect(state.get).toHaveBeenCalledWith('https://images.test/avatar', expect.objectContaining({ proxy: false, maxContentLength: 5 * 1024 * 1024, timeout: 15000 }));
    expect(state.spawn).toHaveBeenCalledWith('https://www.youtube.com/@test', expect.objectContaining({ playlistItems: '0', skipDownload: true }));
  });
  it('never uses a banner when a channel has no avatar', async () => {
    state.spawn.mockReturnValue(processResult({ thumbnails: [{ id: 'banner_uncropped', url: 'https://images.test/banner' }] }));
    await expect(fetchAuthorSourceAvatar({ platform: 'youtube', channelUrl: 'https://www.youtube.com/@test' })).rejects.toThrow('did not provide');
    expect(state.get).not.toHaveBeenCalled();
  });
  it('uses a precise Bilibili author lookup and the existing Twitch API', async () => {
    state.bili.mockResolvedValue({ results: [{ channelUrl: 'https://space.bilibili.com/123', avatarUrl: 'https://i0.hdslb.com/avatar.png' }] });
    await fetchAuthorSourceAvatar({ platform: 'bilibili', channelUrl: 'https://space.bilibili.com/123' });
    expect(state.bili).toHaveBeenCalledWith('https://space.bilibili.com/123', 1);
    state.twitch.mockResolvedValue({ profileImageUrl: 'https://static-cdn.jtvnw.net/avatar.png' });
    await fetchAuthorSourceAvatar({ platform: 'twitch', channelUrl: 'https://www.twitch.tv/test' });
    expect(state.twitch).toHaveBeenCalledWith('test');
  });
  it('fails on invalid proxy configuration without downloading directly', async () => {
    state.twitch.mockResolvedValue({ profileImageUrl: 'https://static-cdn.jtvnw.net/avatar.png' });
    state.proxy.mockImplementationOnce(() => { throw new Error('bad proxy'); });
    await expect(fetchAuthorSourceAvatar({ platform: 'twitch', channelUrl: 'https://www.twitch.tv/test' })).rejects.toThrow('bad proxy');
    expect(state.get).not.toHaveBeenCalled();
  });
  it('rejects oversized, forged or unsupported images', async () => {
    state.twitch.mockResolvedValue({ profileImageUrl: 'https://static-cdn.jtvnw.net/avatar.png' });
    for (const data of [Buffer.alloc(5 * 1024 * 1024 + 1), Buffer.from('<html>error</html>'), Buffer.from('GIF89a')]) {
      state.get.mockResolvedValueOnce({ data });
      await expect(fetchAuthorSourceAvatar({ platform: 'twitch', channelUrl: 'https://www.twitch.tv/test' })).rejects.toThrow();
    }
  });
  it('caps concurrent processes and retains cancelled slots until process close', async () => {
    const first = pendingProcess(), second = pendingProcess();
    state.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const one = new AbortController(), two = new AbortController();
    const oneResult = expect(fetchAuthorSourceAvatar({ platform: 'youtube', channelUrl: 'https://www.youtube.com/@one' }, one.signal)).rejects.toThrow('cancelled');
    const twoResult = expect(fetchAuthorSourceAvatar({ platform: 'youtube', channelUrl: 'https://www.youtube.com/@two' }, two.signal)).rejects.toThrow('cancelled');
    await expect(fetchAuthorSourceAvatar({ platform: 'youtube', channelUrl: 'https://www.youtube.com/@three' })).rejects.toThrow('busy');
    expect(state.spawn).toHaveBeenCalledTimes(2);
    one.abort(); two.abort(); await oneResult; await twoResult;
    await expect(fetchAuthorSourceAvatar({ platform: 'youtube', channelUrl: 'https://www.youtube.com/@three' })).rejects.toThrow('busy');
    first.close(); second.close(); await Promise.resolve(); await Promise.resolve();
    state.spawn.mockReturnValueOnce(processResult({ thumbnails: [{ id: 'avatar_uncropped', url: 'https://images.test/avatar' }] }));
    await expect(fetchAuthorSourceAvatar({ platform: 'youtube', channelUrl: 'https://www.youtube.com/@three' })).resolves.toMatchObject({ mime: 'image/png' });
  });
  it('kills a stalled YouTube lookup at the deadline', async () => {
    vi.useFakeTimers();
    const pending = pendingProcess();
    state.spawn.mockReturnValue(pending);
    const result = expect(fetchAuthorSourceAvatar({ platform: 'youtube', channelUrl: 'https://www.youtube.com/@test' })).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(40000); await result;
    expect(pending.kill).toHaveBeenCalledWith('SIGKILL');
    pending.close(); await Promise.resolve(); await Promise.resolve();
  });
});
