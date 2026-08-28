import Database from "better-sqlite3";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { collections, subscriptions, videos } from "../../../../db/schema";

/**
 * An in-memory database for the media-server export catalog, built by running
 * the project's real Drizzle migrations so the catalog is exercised against the
 * same schema, indexes, and foreign keys production uses.
 */
export function createCatalogTestDatabase(): {
  sqlite: Database.Database;
  db: ReturnType<typeof drizzle>;
} {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  // Several long-standing columns exist only because migrateColumnsAndTables()
  // adds them at startup, never because a Drizzle migration created them. Do the
  // same additive pass here so a migrations-only database matches the declared
  // schema; constraints on those columns are irrelevant to these tests.
  for (const table of [videos, collections, subscriptions]) {
    addMissingColumns(sqlite, table);
  }

  return { sqlite, db };
}

function addMissingColumns(sqlite: Database.Database, table: Table): void {
  const tableName = getTableName(table);
  const existing = new Set(
    (
      sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        name: string;
      }>
    ).map((column) => column.name)
  );

  for (const column of Object.values(getTableColumns(table))) {
    if (!existing.has(column.name)) {
      sqlite.exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.getSQLType()}`
      );
    }
  }
}

export function insertVideoRow(
  sqlite: Database.Database,
  video: {
    id: string;
    title: string;
    author?: string;
    source?: string;
    channelUrl?: string;
    videoPath?: string;
    mediaType?: string;
    createdAt?: string;
  }
): void {
  sqlite
    .prepare(
      `INSERT INTO videos (id, title, author, source, channel_url, video_path, media_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      video.id,
      video.title,
      video.author ?? null,
      video.source ?? "YouTube",
      video.channelUrl ?? null,
      video.videoPath ?? `/videos/${video.id}.mp4`,
      video.mediaType ?? "video",
      video.createdAt ?? "2026-01-01T00:00:00.000Z"
    );
}

export function insertCollectionRow(
  sqlite: Database.Database,
  collection: {
    id: string;
    name: string;
    createdAt?: string;
    sourceType?: string;
    sourceChannelId?: string;
  }
): void {
  sqlite
    .prepare(
      `INSERT INTO collections (id, name, title, created_at, source_type, source_channel_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      collection.id,
      collection.name,
      collection.name,
      collection.createdAt ?? "2026-01-01T00:00:00.000Z",
      collection.sourceType ?? "playlist",
      collection.sourceChannelId ?? null
    );
}
