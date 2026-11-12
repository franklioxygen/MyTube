import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import express from "express";
import fs from "fs-extra";
import type { Server } from "http";

const state = vi.hoisted(() => ({ db: undefined as any, dir: '', login: false, dimensions: { width: 512, height: 512 }, fail: false, fetchSource: vi.fn(), settings: {} as Record<string, unknown> }));
vi.mock('../../db', () => ({ get db() { return state.db; } }));
vi.mock('../../services/storageService/settings', () => ({ getSettings: () => state.settings }));
vi.mock('../../config/paths', async importOriginal => {
  const fs = await import('fs'); const os = await import('os'); const path = await import('path');
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-controller-'));
  return { ...await importOriginal<object>(), AVATARS_DIR: state.dir };
});
vi.mock('../../services/authorAvatarFetchService', () => ({ fetchAuthorSourceAvatar: state.fetchSource }));
vi.mock('../../services/passwordService', () => ({ isLoginRequired: () => state.login }));
vi.mock('../../services/mediaServerExport/bulkArtifactRefresh', () => ({ queueBulkArtifactRefresh: vi.fn() }));
vi.mock('../../utils/security', async importOriginal => ({ ...await importOriginal<object>(), execFileSafe: async () => ({ stdout: JSON.stringify({ streams: [state.dimensions] }) }) }));
vi.mock('../../utils/avatarUtils', () => ({ resizeAvatar: async (_input: string, output: string) => { if (state.fail) return false; await fs.writeFile(output, 'jpeg-output'); return true; } }));
import { avatarUpload, readProfile, uploadAvatar, removeAvatar, fetchSourceAvatar, avatarSourceLimiter } from '../../controllers/authorAvatarController';
import { requireAdmin } from '../../middleware/requireAdmin';
import { asyncHandler, errorHandler } from '../../middleware/errorHandler';
import { getVideosListETag } from '../../services/storageService/videoListRevision';

let sqlite: Database.Database, server: Server, url: string;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64');
function form(bytes: Buffer = png, type = 'image/png') {
  const body = new FormData(); body.append('author', '作者 / 🎬'); body.append('avatar', new Blob([new Uint8Array(bytes)], { type }), 'image.png'); return body;
}
beforeAll(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE author_profiles (author TEXT PRIMARY KEY, custom_avatar_path TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE videos (id TEXT PRIMARY KEY, author TEXT, source TEXT, channel_url TEXT, author_avatar_path TEXT, created_at TEXT);`);
  state.db = drizzle(sqlite);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers['x-test-role']) req.user = { role: req.headers['x-test-role'] as 'admin' | 'visitor' }; if (req.headers['x-api-key']) req.apiKeyAuthenticated = true; next(); });
  app.post('/authors/avatar/from-source', requireAdmin, avatarSourceLimiter, asyncHandler(fetchSourceAvatar));
  app.get('/authors/profile', requireAdmin, asyncHandler(readProfile));
  app.put('/authors/avatar', requireAdmin, avatarUpload.single('avatar'), asyncHandler(uploadAvatar));
  app.delete('/authors/avatar', requireAdmin, asyncHandler(removeAvatar));
  app.use(errorHandler);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(() => { avatarSourceLimiter.resetKey('127.0.0.1'); sqlite.exec('DELETE FROM author_profiles; DELETE FROM videos'); fs.emptyDirSync(state.dir); state.login = false; state.fail = false; state.settings = {}; state.dimensions = { width: 512, height: 512 }; state.fetchSource.mockReset().mockResolvedValue({ buffer: png, mime: 'image/png' }); });
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); sqlite.close(); fs.removeSync(state.dir); });

describe('author avatar HTTP contract', () => {
  it('keeps a long legacy profile readable, replaceable, and removable after its last video is deleted', async () => {
    const author = ` ${'作'.repeat(201)} `;
    const avatarForm = () => { const body = form(); body.set('author', author); return body; };
    const profileUrl = url + '/authors/profile?author=' + encodeURIComponent(author);
    sqlite.prepare('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)').run('legacy', author, 'local', null, null, '2026');
    const first = await fetch(url + '/authors/avatar', { method: 'PUT', body: avatarForm() });
    expect(first.status).toBe(200);
    const firstProfile = (await first.json() as any).data;
    sqlite.prepare('DELETE FROM videos WHERE id = ?').run('legacy');

    const read = await fetch(profileUrl);
    expect(read.status).toBe(200);
    expect((await read.json() as any).data).toMatchObject({ author, videoCount: 0, customAvatarPath: firstProfile.customAvatarPath });
    // An unknown exact key still cannot bypass the limit for new names.
    expect((await fetch(url + '/authors/profile?author=' + encodeURIComponent(author.trim()))).status).toBe(400);

    const replaced = await fetch(url + '/authors/avatar', { method: 'PUT', body: avatarForm() });
    expect(replaced.status).toBe(200);
    const replacedProfile = (await replaced.json() as any).data;
    expect(replacedProfile.author).toBe(author);
    expect(replacedProfile.customAvatarPath).not.toBe(firstProfile.customAvatarPath);
    expect(fs.readdirSync(state.dir)).toEqual([replacedProfile.customAvatarPath.split('/').pop()]);

    const removed = await fetch(url + '/authors/avatar', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author }) });
    expect(removed.status).toBe(200);
    expect((await removed.json() as any).data).toMatchObject({ author, customAvatarPath: null, videoCount: 0 });
    expect(sqlite.prepare('SELECT author, custom_avatar_path FROM author_profiles').all()).toEqual([{ author, custom_avatar_path: null }]);
    expect(fs.readdirSync(state.dir)).toEqual([]);
    const afterRestore = await fetch(profileUrl);
    expect(afterRestore.status).toBe(200);
    expect((await afterRestore.json() as any).data).toMatchObject({ author, customAvatarPath: null, avatarOrigin: 'none' });
    const uploadedAgain = await fetch(url + '/authors/avatar', { method: 'PUT', body: avatarForm() });
    expect(uploadedAgain.status).toBe(200);
    expect((await uploadedAgain.json() as any).data).toMatchObject({ author, avatarOrigin: 'custom', videoCount: 0 });
  });

  it('saves and restores an exact Unicode name, leaving video storage untouched and changing ETags', async () => {
    sqlite.prepare('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)').run('v', '作者 / 🎬', 'local', null, '/avatars/auto.jpg', '2026');
    const etag = getVideosListETag('all');
    const saved = await fetch(url + '/authors/avatar', { method: 'PUT', body: form() });
    expect(saved.status).toBe(200); const { data } = await saved.json() as any;
    expect(data).toMatchObject({ author: '作者 / 🎬', avatarOrigin: 'custom', defaultAvatarPath: '/avatars/auto.jpg', videoCount: 1 });
    expect(fs.readdirSync(state.dir)).toHaveLength(1); expect(getVideosListETag('all')).not.toBe(etag);
    const profile = await fetch(url + '/authors/profile?author=' + encodeURIComponent('作者 / 🎬'));
    expect((await profile.json() as any).data.customAvatarPath).toBe(data.customAvatarPath);
    const restored = await fetch(url + '/authors/avatar', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: '作者 / 🎬' }) });
    expect((await restored.json() as any).data).toMatchObject({ customAvatarPath: null, effectiveAvatarPath: '/avatars/auto.jpg', avatarOrigin: 'auto' });
    expect(fs.readdirSync(state.dir)).toEqual([]);
    expect(sqlite.prepare('SELECT author_avatar_path AS path FROM videos').get()).toEqual({ path: '/avatars/auto.jpg' });
  });
  it('keeps only the final asset when two uploads complete concurrently', async () => {
    const responses = await Promise.all([1, 2].map(() => fetch(url + '/authors/avatar', { method: 'PUT', body: form() })));
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const current = (await (await fetch(url + '/authors/profile?author=' + encodeURIComponent('作者 / 🎬'))).json() as any).data;
    expect(fs.readdirSync(state.dir)).toEqual([current.customAvatarPath.split('/').pop()]);
  });
  it('fetches a source preview without changing saved avatars, files or ETags', async () => {
    sqlite.prepare('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)').run('v', '作者 / 🎬', 'youtube', 'https://youtube.com/@test/videos', '/avatars/auto.jpg', '2026');
    const saved = await (await fetch(url + '/authors/avatar', { method: 'PUT', body: form() })).json() as any;
    const etag = getVideosListETag('all');
    const response = await fetch(url + '/authors/avatar/from-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: '作者 / 🎬', channelUrl: 'https://www.youtube.com/@test' }) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(fs.readdirSync(state.dir)).toEqual([saved.data.customAvatarPath.split('/').pop()]);
    expect(getVideosListETag('all')).toBe(etag);
    expect(state.fetchSource).toHaveBeenCalledWith({ platform: 'youtube', channelUrl: 'https://www.youtube.com/@test' }, expect.any(AbortSignal));
  });
  it('rejects arbitrary or unrelated source URLs before any network call', async () => {
    for (const channelUrl of ['http://127.0.0.1/private', 'https://youtube.com/@other']) {
      const response = await fetch(url + '/authors/avatar/from-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: '作者 / 🎬', channelUrl }) });
      expect(response.status).toBe(400);
    }
    expect(state.fetchSource).not.toHaveBeenCalled();
  });
  it('offers Twitch fetching only with complete credentials and rechecks settings before a fetch', async () => {
    const author = 'Twitch Author';
    const channelUrl = 'https://www.twitch.tv/test';
    sqlite.prepare('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)').run('v', author, 'twitch', channelUrl, '/avatars/cached.jpg', '2026');
    const profile = () => fetch(url + '/authors/profile?author=' + encodeURIComponent(author));
    const preview = () => fetch(url + '/authors/avatar/from-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author, channelUrl }) });
    expect((await (await profile()).json() as any).data).toMatchObject({ avatarSources: [], effectiveAvatarPath: '/avatars/cached.jpg' });
    expect((await preview()).status).toBe(400);
    expect(state.fetchSource).not.toHaveBeenCalled();
    state.settings = { twitchClientId: 'id', twitchClientSecret: 'secret' };
    expect((await (await profile()).json() as any).data.avatarSources).toEqual([{ platform: 'twitch', channelUrl }]);
    expect((await preview()).status).toBe(200);
    expect(state.fetchSource).toHaveBeenCalledTimes(1);
    // A previously offered source must stop working if credentials are removed.
    state.settings = {};
    expect((await preview()).status).toBe(400);
    expect(state.fetchSource).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(state.dir)).toEqual([]);
  });
  it('rejects unexpected preview response types without returning active content', async () => {
    sqlite.prepare('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)').run('v', '作者 / 🎬', 'youtube', 'https://youtube.com/@test', null, '2026');
    for (const result of [{ buffer: Buffer.from('<script>alert(1)</script>'), mime: 'text/html' }, { buffer: '<script>alert(1)</script>', mime: 'image/png' }]) {
      state.fetchSource.mockResolvedValueOnce(result);
      const response = await fetch(url + '/authors/avatar/from-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: '作者 / 🎬', channelUrl: 'https://www.youtube.com/@test' }) });
      expect(response.status).toBe(502);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.text()).not.toContain('<script>');
      expect(fs.readdirSync(state.dir)).toEqual([]);
    }
  });
  it('keeps current state when the source is unavailable', async () => {
    sqlite.prepare('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)').run('v', '作者 / 🎬', 'youtube', 'https://youtube.com/@test', '/avatars/auto.jpg', '2026');
    state.fetchSource.mockRejectedValueOnce(new Error('offline'));
    const response = await fetch(url + '/authors/avatar/from-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: '作者 / 🎬', channelUrl: 'https://www.youtube.com/@test' }) });
    expect(response.status).toBe(502); expect(fs.readdirSync(state.dir)).toEqual([]);
    expect(sqlite.prepare('SELECT author_avatar_path AS path FROM videos').get()).toEqual({ path: '/avatars/auto.jpg' });
  });
  it.each([['visitor', 403], ['', 401]])('rejects source fetch for %s', async (role, status) => {
    state.login = true;
    const response = await fetch(url + '/authors/avatar/from-source', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: JSON.stringify({ author: '作者 / 🎬' }) });
    expect(response.status).toBe(status); expect(state.fetchSource).not.toHaveBeenCalled();
  });
  it.each([['visitor', 403], ['', 401]])('rejects %s before multipart parsing', async (role, status) => {
    state.login = true;
    const res = await fetch(url + '/authors/avatar', { method: 'PUT', headers: role ? { 'x-test-role': role } : {}, body: form(Buffer.alloc(3 * 1024 * 1024)) });
    expect(res.status).toBe(status); expect(fs.readdirSync(state.dir)).toEqual([]);
  });
  it('rejects API keys even with login disabled', async () => {
    const res = await fetch(url + '/authors/avatar', { method: 'PUT', headers: { 'x-api-key': 'test' }, body: form() });
    expect(res.status).toBe(403);
  });
  it('reports the avatar size limit and rejects forged images', async () => {
    const large = await fetch(url + '/authors/avatar', { method: 'PUT', body: form(Buffer.alloc(3 * 1024 * 1024)) });
    expect(large.status).toBe(413); expect((await large.json() as any).error).toContain('2 MiB');
    const invalid = await fetch(url + '/authors/avatar', { method: 'PUT', body: form(Buffer.from('not an image')) });
    expect(invalid.status).toBe(400); expect(fs.readdirSync(state.dir)).toEqual([]);
  });
  it('rate-limits source requests separately from the general API limiter', async () => {
    for (let i = 0; i < 10; i++) {
      const response = await fetch(url + '/authors/avatar/from-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: 'A' }) });
      expect(response.status).toBe(400);
    }
    const limited = await fetch(url + '/authors/avatar/from-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: 'A' }) });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(state.fetchSource).not.toHaveBeenCalled();
  });
  it('retains the current avatar on invalid dimensions or conversion failure', async () => {
    const first = await (await fetch(url + '/authors/avatar', { method: 'PUT', body: form() })).json() as any;
    state.dimensions = { width: 1025, height: 512 };
    expect((await fetch(url + '/authors/avatar', { method: 'PUT', body: form() })).status).toBe(400);
    state.dimensions = { width: 512, height: 512 }; state.fail = true;
    expect((await fetch(url + '/authors/avatar', { method: 'PUT', body: form() })).status).toBe(400);
    expect(fs.readdirSync(state.dir)).toEqual([first.data.customAvatarPath.split('/').pop()]);
  });
  it('removes newly generated files when a transaction fails', async () => {
    sqlite.exec("CREATE TRIGGER reject_avatar BEFORE INSERT ON author_profiles BEGIN SELECT RAISE(ABORT, 'fail'); END;");
    expect((await fetch(url + '/authors/avatar', { method: 'PUT', body: form() })).status).toBe(400);
    expect(fs.readdirSync(state.dir)).toEqual([]);
    sqlite.exec('DROP TRIGGER reject_avatar');
  });
});
