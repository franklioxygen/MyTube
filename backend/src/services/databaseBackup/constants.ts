import path from "path";
import { DATA_DIR } from "../../config/paths";

export const dbPath = path.join(DATA_DIR, "mytube.db");
export const backupPattern = /^mytube-backup-(.+)\.db\.backup$/;
export const RESOLVED_DATA_DIR = path.resolve(DATA_DIR);
export const RESOLVED_DB_PATH = path.resolve(dbPath);
