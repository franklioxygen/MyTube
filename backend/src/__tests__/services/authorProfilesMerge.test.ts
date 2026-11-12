import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeDatabaseMerge } from '../../services/databaseBackup/tableMerges';
import { MERGEABLE_TABLES } from '../../services/databaseBackup/types';
vi.mock('../../services/storageService/settings', () => ({ invalidateSettingsCache: vi.fn() }));
let source: Database.Database, target: Database.Database;
const table = 'CREATE TABLE author_profiles (author TEXT PRIMARY KEY, custom_avatar_path TEXT NOT NULL, updated_at INTEGER NOT NULL)';
beforeEach(() => { source = new Database(':memory:'); target = new Database(':memory:'); source.exec(table); target.exec(table); });
afterEach(() => { source.close(); target.close(); });
describe('author profile database merges', () => {
  it('previews and imports exact author keys while preserving target conflicts', () => {
    target.prepare('INSERT INTO author_profiles VALUES (?, ?, ?)').run('A', '/avatars/custom-aaaa.jpg', 1);
    const insert = source.prepare('INSERT INTO author_profiles VALUES (?, ?, ?)');
    insert.run('A', '/avatars/custom-bbbb.jpg', 999);
    insert.run('a', '/avatars/custom-cccc.jpg', 2);
    insert.run(' A ', '/avatars/custom-dddd.jpg', 3);
    insert.run('unsafe', '/avatars/custom-../../secret.jpg', 4);
    const preview = executeDatabaseMerge(source, target, { applyChanges: false, persistTagSettings: false });
    expect(preview.authorProfiles).toEqual({ merged: 2, skipped: 2 });
    expect(target.prepare('SELECT count(*) AS count FROM author_profiles').get()).toEqual({ count: 1 });
    const applied = executeDatabaseMerge(source, target, { applyChanges: true, persistTagSettings: false });
    expect(applied).toEqual(preview);
    expect(target.prepare('SELECT custom_avatar_path AS path FROM author_profiles WHERE author = ?').get('A')).toEqual({ path: '/avatars/custom-aaaa.jpg' });
    expect(target.prepare('SELECT author FROM author_profiles ORDER BY author').all()).toEqual([{ author: ' A ' }, { author: 'A' }, { author: 'a' }]);
    expect(executeDatabaseMerge(source, target, { applyChanges: true, persistTagSettings: false }).authorProfiles).toEqual({ merged: 0, skipped: 4 });
    expect(MERGEABLE_TABLES).toContain('author_profiles');
  });
  it('accepts older backups without the profile table', () => {
    source.exec('DROP TABLE author_profiles');
    expect(executeDatabaseMerge(source, target, { applyChanges: true, persistTagSettings: false }).authorProfiles).toEqual({ merged: 0, skipped: 0 });
  });
});
