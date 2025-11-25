import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import { DATA_DIR } from '../config/paths';
import * as schema from './schema';

// Ensure data directory exists
fs.ensureDirSync(DATA_DIR);

const dbPath = path.join(DATA_DIR, 'mytube.db');
const sqlite = new Database(dbPath);

export const db = drizzle(sqlite, { schema });
