import fs from "fs";
import os from "os";
import path from "path";
import { afterAll } from "vitest";

/**
 * Give every test file its own data directory.
 *
 * `DATA_DIR` is where `db/index.ts` opens mytube.db, where the migration
 * runner writes, and where services drop generated files. Without this, a test
 * run operates on the developer's real `backend/data` - it applies pending
 * Drizzle migrations to their database and lets one test's settings write
 * change what a later test reads. That made results depend on file contents
 * and on vitest's ordering rather than on the code under test.
 *
 * This runs before the test module is imported, so `config/paths.ts` reads the
 * override when it is first evaluated. Vitest isolates module registries per
 * file, so each file gets a fresh directory and a fresh database.
 */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-test-data-"));
process.env.MYTUBE_BACKEND_DATA_DIR = dataDir;

afterAll(() => {
  // Best effort: an open SQLite handle can keep a file busy, and a leaked
  // temp directory is not worth failing a green run over.
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
