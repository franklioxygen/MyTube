import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs-extra";
import os from "os";
import path from "path";

const state = vi.hoisted(() => ({ db: undefined as any, dir: '', settings: {} as Record<string, unknown> }));
vi.mock('../../db', () => ({ get db() { return state.db; } }));
vi.mock('../../services/storageService/settings', () => ({ getSettings: () => state.settings }));
vi.mock('../../config/paths', async () => {
  const fs = await import('fs'); const os = await import('os'); const path = await import('path');
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'author-avatar-test-'));
  return { AVATARS_DIR: state.dir };
});
import { getAuthorProfile, getCustomAvatarPaths, projectAuthorAvatars, saveAuthorAvatar } from '../../services/authorAvatarService';
import { getVideosListETag } from '../../services/storageService/videoListRevision';

let sqlite: Database.Database;
beforeAll(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE author_profiles (author TEXT PRIMARY KEY, custom_avatar_path TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE videos (id TEXT PRIMARY KEY, author TEXT, source TEXT, channel_url TEXT, author_avatar_path TEXT, created_at TEXT);`);
  state.db = drizzle(sqlite);
});
beforeEach(() => { sqlite.exec('DELETE FROM author_profiles; DELETE FROM videos;'); fs.emptyDirSync(state.dir); state.settings = {}; });
afterAll(() => { sqlite.close(); fs.removeSync(state.dir); });
const asset = (name: string) => { fs.writeFileSync(path.join(state.dir, `custom-${name}.jpg`), 'image'); return `/avatars/custom-${name}.jpg`; };

describe('author avatar persistence and projection', () => {
  it('overrides exact names across sources without changing raw video data or other names', () => {
    const custom = asset('first');
    saveAuthorAvatar('Alice', custom);
    const raw = [{ author: 'Alice', source: 'youtube', authorAvatarPath: '/avatars/auto.jpg' },
      { author: 'Alice', source: 'local' }, { author: 'alice', source: 'youtube' }];
    expect(projectAuthorAvatars(raw).map(v => [v.authorAvatarPath, v.authorAvatarOrigin])).toEqual([
      [custom, 'custom'], [custom, 'custom'], [undefined, 'none']]);
    expect(raw[0].authorAvatarPath).toBe('/avatars/auto.jpg');
    expect(raw[1]).not.toHaveProperty('authorAvatarPath');
  });
  it('offers deduplicated supported channels without inferring a channel for local-only authors', () => {
    const insert = sqlite.prepare('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('one', 'A', 'youtube', 'https://youtube.com/@test/videos', null, '2026');
    insert.run('two', 'A', 'local', 'https://www.youtube.com/@test', null, '2026');
    insert.run('three', 'A', 'bilibili', 'https://space.bilibili.com/123', null, '2026');
    insert.run('four', 'A', 'local', 'http://127.0.0.1/private', null, '2026');
    expect(getAuthorProfile('A').avatarSources).toEqual([
      { platform: 'youtube', channelUrl: 'https://www.youtube.com/@test' },
      { platform: 'bilibili', channelUrl: 'https://space.bilibili.com/123' },
    ]);
    expect(getAuthorProfile('local').avatarSources).toEqual([]);
  });
  it('restores defaults, deletes only replaced custom assets, and invalidates ETags', () => {
    sqlite.prepare('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)').run('v1', '作者 / 🎬', 'youtube', null, '/avatars/auto.jpg', '2026-01-01');
    const before = getVideosListETag('all');
    const first = asset('one'), second = asset('two');
    saveAuthorAvatar('作者 / 🎬', first);
    expect(getVideosListETag('all')).not.toBe(before);
    saveAuthorAvatar('作者 / 🎬', second);
    expect(fs.existsSync(path.join(state.dir, 'custom-one.jpg'))).toBe(false);
    expect(getAuthorProfile('作者 / 🎬')).toMatchObject({ defaultAvatarPath: '/avatars/auto.jpg', customAvatarPath: second, videoCount: 1 });
    saveAuthorAvatar('作者 / 🎬', null);
    expect(fs.existsSync(path.join(state.dir, 'custom-two.jpg'))).toBe(false);
    expect(getAuthorProfile('作者 / 🎬')).toMatchObject({ effectiveAvatarPath: '/avatars/auto.jpg', avatarOrigin: 'auto' });
    expect(sqlite.prepare('SELECT author_avatar_path AS path FROM videos').get()).toEqual({ path: '/avatars/auto.jpg' });
  });
  it.each([{}, { twitchClientId: 'id' }, { twitchClientSecret: 'secret' }, { twitchClientId: '  ', twitchClientSecret: 'secret' }, { twitchClientId: 'id', twitchClientSecret: '  ' }])(
    'omits unavailable Twitch sources while retaining other sources and cached artwork (%j)', settings => {
      state.settings = settings;
      const insert = sqlite.prepare('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)');
      insert.run('twitch', 'A', 'twitch', 'https://www.twitch.tv/test', '/avatars/cached.jpg', '2026');
      insert.run('youtube', 'A', 'youtube', 'https://youtube.com/@test', null, '2026');
      insert.run('bilibili', 'A', 'bilibili', 'https://space.bilibili.com/123', null, '2026');
      expect(getAuthorProfile('A')).toMatchObject({ defaultAvatarPath: '/avatars/cached.jpg', videoCount: 3, avatarSources: [
        { platform: 'youtube', channelUrl: 'https://www.youtube.com/@test' },
        { platform: 'bilibili', channelUrl: 'https://space.bilibili.com/123' },
      ] });
    }
  );
  it('includes Twitch sources when both credentials are configured and reflects their removal', () => {
    sqlite.prepare('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)').run('v', 'A', 'twitch', 'https://www.twitch.tv/test', null, '2026');
    state.settings = { twitchClientId: ' id ', twitchClientSecret: ' secret ' };
    expect(getAuthorProfile('A').avatarSources).toEqual([{ platform: 'twitch', channelUrl: 'https://www.twitch.tv/test' }]);
    state.settings = {};
    expect(getAuthorProfile('A').avatarSources).toEqual([]);
  });
  it('falls back when custom files are missing and keeps profiles without videos', () => {
    saveAuthorAvatar('new', asset('saved'));
    expect(getAuthorProfile('new').videoCount).toBe(0);
    fs.unlinkSync(path.join(state.dir, 'custom-saved.jpg'));
    expect(getCustomAvatarPaths(['new']).size).toBe(0);
  });
  it('rolls back the profile when a database trigger rejects an update', () => {
    const first = asset('good'); saveAuthorAvatar('A', first);
    sqlite.exec("CREATE TRIGGER reject_avatar BEFORE UPDATE ON author_profiles BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    expect(() => saveAuthorAvatar('A', asset('rejected'))).toThrow();
    expect(getCustomAvatarPaths(['A']).get('A')).toBe(first);
    expect(fs.existsSync(path.join(state.dir, 'custom-good.jpg'))).toBe(true);
    sqlite.exec('DROP TRIGGER reject_avatar');
  });
});
