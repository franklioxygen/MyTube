import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import { ROOT_DIR } from '../config/paths';
import { db } from './index';

import { sqlite } from './index';

function ensureSchemaUpdates() {
  try {
    const updates = [
      { table: 'downloads', column: 'source_url', type: 'text' },
      { table: 'downloads', column: 'type', type: 'text' },
      { table: 'videos', column: 'tags', type: 'text' },
      { table: 'videos', column: 'progress', type: 'integer' },
      { table: 'videos', column: 'last_played_at', type: 'integer' },
      { table: 'videos', column: 'subtitles', type: 'text' },
    ];

    for (const update of updates) {
      const info = sqlite.prepare(`PRAGMA table_info(${update.table})`).all() as any[];
      const exists = info.some(col => col.name === update.column);
      if (!exists) {
        console.log(`Adding missing column ${update.column} to ${update.table}`);
        sqlite.prepare(`ALTER TABLE \`${update.table}\` ADD \`${update.column}\` ${update.type}`).run();
      }
    }
  } catch (error) {
    console.error('Error ensuring schema updates:', error);
  }
}

export function runMigrations() {
  try {
    console.log('Running database migrations...');
    
    // Ensure schema updates for columns that might already exist
    ensureSchemaUpdates();

    // In production/docker, the drizzle folder is copied to the root or src/drizzle
    // We need to find where it is.
    // Based on Dockerfile: COPY . . -> it should be at /app/drizzle
    
    const migrationsFolder = path.join(ROOT_DIR, 'drizzle');
    
    migrate(db, { migrationsFolder });
    console.log('Database migrations completed successfully.');
  } catch (error) {
    console.error('Error running database migrations:', error);
    // Don't throw, as we might want the app to start even if migration fails (though it might be broken)
    // But for initial setup, it's critical.
    throw error;
    // console.warn("Migration failed but continuing server startup...");
  }
}
