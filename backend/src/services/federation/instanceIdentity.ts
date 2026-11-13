import crypto from "crypto";
import { sqlite } from "../../db";

const INSTANCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Instance IDs are lowercase RFC 9562 UUIDs. */
export const isInstanceId = (value: unknown): value is string =>
  typeof value === "string" && INSTANCE_ID_PATTERN.test(value);

const readInstanceId = (): string | undefined =>
  (
    sqlite
      .prepare("SELECT instance_id FROM federation_instance WHERE id = 1")
      .get() as { instance_id: string } | undefined
  )?.instance_id;

/**
 * This deployment's stable federation identity, created once on first use.
 *
 * Deliberately not cached in memory: a database restore replaces the row
 * underneath the running process, and the identity must follow the restored
 * database rather than outlive it.
 */
export function getInstanceId(): string {
  const existing = readInstanceId();
  if (existing) {
    return existing;
  }

  // INSERT OR IGNORE keeps the first identity if two callers race here.
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO federation_instance (id, instance_id, created_at) VALUES (1, ?, ?)"
    )
    .run(crypto.randomUUID(), Date.now());

  const created = readInstanceId();
  if (!created) {
    throw new Error("Federation instance identity could not be persisted");
  }
  return created;
}
