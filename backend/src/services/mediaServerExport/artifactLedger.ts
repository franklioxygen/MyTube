import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { mediaServerExportArtifacts } from "../../db/schema";
import type { MediaServerExportArtifact } from "./types";

/**
 * Ownership ledger for every file MyTube writes into the managed mirror
 * (issue #411). A hard link or a copied media file carries no in-band marker,
 * so a ledger row is the only evidence that a mirror path may be deleted.
 */

type ArtifactRow = typeof mediaServerExportArtifacts.$inferSelect;

function toArtifact(row: ArtifactRow): MediaServerExportArtifact {
  return {
    relativePath: row.relativePath,
    artifactType: row.artifactType as MediaServerExportArtifact["artifactType"],
    showId: row.showId ?? undefined,
    assignmentId: row.assignmentId ?? undefined,
    sourceAbsolutePath: row.sourceAbsolutePath ?? undefined,
    sourceSize: row.sourceSize ?? undefined,
    sourceMtimeMs: row.sourceMtimeMs ?? undefined,
    materialization:
      row.materialization as MediaServerExportArtifact["materialization"],
  };
}

/**
 * List tracked artifacts. Passing `showIds` limits the result to a scope, which
 * is what keeps an incremental run from sweeping artifacts of shows it never
 * planned.
 */
export function listArtifacts(
  showIds?: readonly string[]
): MediaServerExportArtifact[] {
  if (!showIds) {
    return db.select().from(mediaServerExportArtifacts).all().map(toArtifact);
  }
  if (showIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(mediaServerExportArtifacts)
    .where(inArray(mediaServerExportArtifacts.showId, [...showIds]))
    .all()
    .map(toArtifact);
}

export function getArtifact(
  relativePath: string
): MediaServerExportArtifact | undefined {
  const row = db
    .select()
    .from(mediaServerExportArtifacts)
    .where(eq(mediaServerExportArtifacts.relativePath, relativePath))
    .get();
  return row ? toArtifact(row) : undefined;
}

export function upsertArtifact(artifact: MediaServerExportArtifact): void {
  const now = Date.now();
  const values = {
    relativePath: artifact.relativePath,
    artifactType: artifact.artifactType,
    showId: artifact.showId ?? null,
    assignmentId: artifact.assignmentId ?? null,
    sourceAbsolutePath: artifact.sourceAbsolutePath ?? null,
    sourceSize: artifact.sourceSize ?? null,
    sourceMtimeMs: artifact.sourceMtimeMs ?? null,
    materialization: artifact.materialization,
  };

  db.insert(mediaServerExportArtifacts)
    .values({ ...values, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: mediaServerExportArtifacts.relativePath,
      set: { ...values, updatedAt: now },
    })
    .run();
}

export function deleteArtifact(relativePath: string): void {
  db.delete(mediaServerExportArtifacts)
    .where(eq(mediaServerExportArtifacts.relativePath, relativePath))
    .run();
}
