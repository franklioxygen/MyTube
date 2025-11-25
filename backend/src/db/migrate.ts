import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import { ROOT_DIR } from '../config/paths';
import { db } from './index';

export function runMigrations() {
  try {
    console.log('Running database migrations...');
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
  }
}
