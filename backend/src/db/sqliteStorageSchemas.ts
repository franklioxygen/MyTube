export interface SQLiteStatementLike {
  run: (...args: any[]) => unknown;
  get?: (...args: any[]) => unknown;
  all?: (...args: any[]) => unknown;
}

export interface SQLiteDatabaseLike {
  prepare: (sql: string) => SQLiteStatementLike;
}

export interface SQLiteTableSchemaDefinition {
  name: string;
  createTableSql: string;
  createIndexSql: readonly string[];
}

export const AUTH_SESSIONS_SCHEMA: SQLiteTableSchemaDefinition = {
  name: "auth_sessions",
  createTableSql: `
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      session_hash TEXT NOT NULL,
      user_role TEXT NOT NULL,
      user_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      revoked_reason TEXT,
      auth_method TEXT,
      login_ip TEXT,
      login_user_agent TEXT
    )
  `,
  createIndexSql: [
    "CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_session_hash_uidx ON auth_sessions (session_hash)",
    "CREATE INDEX IF NOT EXISTS auth_sessions_role_idx ON auth_sessions (user_role)",
    "CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions (expires_at)",
  ],
};

export const SECURITY_AUDIT_LOGS_SCHEMA: SQLiteTableSchemaDefinition = {
  name: "security_audit_logs",
  createTableSql: `
    CREATE TABLE IF NOT EXISTS security_audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      source_ip TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      target TEXT NOT NULL,
      result TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `,
  createIndexSql: [
    "CREATE INDEX IF NOT EXISTS security_audit_logs_event_created_idx ON security_audit_logs (event_type, created_at)",
    "CREATE INDEX IF NOT EXISTS security_audit_logs_source_created_idx ON security_audit_logs (source_ip, created_at)",
  ],
};

export const SECURITY_ALERT_WINDOWS_SCHEMA: SQLiteTableSchemaDefinition = {
  name: "security_alert_windows",
  createTableSql: `
    CREATE TABLE IF NOT EXISTS security_alert_windows (
      window_key TEXT PRIMARY KEY NOT NULL,
      timestamps_json TEXT NOT NULL,
      last_alert_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `,
  createIndexSql: [
    "CREATE INDEX IF NOT EXISTS security_alert_windows_updated_idx ON security_alert_windows (updated_at)",
  ],
};

export const HOOK_WORKER_JOBS_SCHEMA: SQLiteTableSchemaDefinition = {
  name: "hook_worker_jobs",
  createTableSql: `
    CREATE TABLE IF NOT EXISTS hook_worker_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      worker_id TEXT,
      payload_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      available_at INTEGER NOT NULL,
      lease_until INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `,
  createIndexSql: [
    "CREATE INDEX IF NOT EXISTS hook_worker_jobs_status_available_idx ON hook_worker_jobs (status, available_at)",
    "CREATE INDEX IF NOT EXISTS hook_worker_jobs_lease_idx ON hook_worker_jobs (lease_until)",
    "CREATE INDEX IF NOT EXISTS hook_worker_jobs_created_idx ON hook_worker_jobs (created_at)",
  ],
};

export const ensureSqliteTableSchema = (
  sqlite: SQLiteDatabaseLike,
  definition: SQLiteTableSchemaDefinition,
  onIndexError?: (error: unknown) => void
): void => {
  sqlite.prepare(definition.createTableSql).run();

  try {
    for (const indexSql of definition.createIndexSql) {
      sqlite.prepare(indexSql).run();
    }
  } catch (error) {
    onIndexError?.(error);
  }
};
