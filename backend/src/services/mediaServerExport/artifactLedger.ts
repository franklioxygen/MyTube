import { eq, like } from "drizzle-orm";
import { db } from "../../db";
import { mediaServerExportArtifacts } from "../../db/schema";
import type {
  MediaServerArtifactType,
  MediaServerExportArtifact,
  MediaServerMaterialization,
} from "../storageService/types";

/**
 * Ownership ledger for the managed media-server mirror (issue #411).
 *
 * A generated NFO carries an in-band MyTube marker, but a hard-linked or copied
 * media file cannot. This table is therefore the ONLY thing that proves MyTube
 * created a path under MEDIA_SERVER_LIBRARY_DIR. Cleanup must consult it before
 * deleting anything; a final path with no row here is an untracked user file and
 * is preserved.
 *
 * Paths are stored relative to the mirror root with POSIX separators so the
 * ledger survives a host/platform change and can never encode an absolute
 * destination.
 */

const ALLOWED_ARTIFACT_TYPES: ReadonlySet<string> = new Set<MediaServerArtifactType>([
  "show_nfo",
  "show_poster",
  "season_nfo",
  "episode_media",
  "episode_nfo",
  "episode_thumb",
  "episode_subtitle",
  "source_json",
]);

const ALLOWED_MATERIALIZATIONS: ReadonlySet<string> =
  new Set<MediaServerMaterialization>([
    "generated_text",
    "copied_image",
    "hard_link",
    "copied_media",
    "copied_subtitle",
  ]);

type ArtifactRow = typeof mediaServerExportArtifacts.$inferSelect;

export class MediaServerArtifactLedgerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MediaServerArtifactLedgerError";
    this.code = code;
  }
}

/**
 * Rejects anything that is not a plain relative POSIX path under the mirror
 * root. The filesystem layer still resolves through resolveSafeChildPath; this
 * keeps a traversal string from ever reaching the ledger in the first place.
 */
export function normalizeLedgerRelativePath(relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new MediaServerArtifactLedgerError(
      "artifact_path_collision",
      "Artifact relative path must be a non-empty string."
    );
  }

  const normalized = relativePath.split("\\").join("/").replace(/^\/+/, "");
  const segments = normalized.split("/");

  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new MediaServerArtifactLedgerError(
      "artifact_path_collision",
      `Invalid artifact relative path: "${relativePath}".`
    );
  }

  return segments.join("/");
}

function toArtifact(row: ArtifactRow): MediaServerExportArtifact {
  return {
    relativePath: row.relativePath,
    artifactType: row.artifactType as MediaServerArtifactType,
    showId: row.showId ?? undefined,
    assignmentId: row.assignmentId ?? undefined,
    sourceAbsolutePath: row.sourceAbsolutePath ?? undefined,
    sourceSize: row.sourceSize ?? undefined,
    sourceMtimeMs: row.sourceMtimeMs ?? undefined,
    materialization: row.materialization as MediaServerMaterialization,
    contentDigest: row.contentDigest ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listArtifacts(): MediaServerExportArtifact[] {
  return db.select().from(mediaServerExportArtifacts).all().map(toArtifact);
}

export function listArtifactsForShow(
  showId: string
): MediaServerExportArtifact[] {
  return db
    .select()
    .from(mediaServerExportArtifacts)
    .where(eq(mediaServerExportArtifacts.showId, showId))
    .all()
    .map(toArtifact);
}

export function listArtifactsForAssignment(
  assignmentId: string
): MediaServerExportArtifact[] {
  return db
    .select()
    .from(mediaServerExportArtifacts)
    .where(eq(mediaServerExportArtifacts.assignmentId, assignmentId))
    .all()
    .map(toArtifact);
}

/**
 * Rows whose path sits under a directory prefix. Used to scope a rebuild sweep
 * to one show subtree without loading the whole ledger.
 */
export function listArtifactsUnderPrefix(
  relativeDirectory: string
): MediaServerExportArtifact[] {
  const prefix = normalizeLedgerRelativePath(relativeDirectory);
  return db
    .select()
    .from(mediaServerExportArtifacts)
    .where(like(mediaServerExportArtifacts.relativePath, `${prefix}/%`))
    .all()
    .map(toArtifact);
}

export function getArtifact(
  relativePath: string
): MediaServerExportArtifact | undefined {
  const row = db
    .select()
    .from(mediaServerExportArtifacts)
    .where(
      eq(
        mediaServerExportArtifacts.relativePath,
        normalizeLedgerRelativePath(relativePath)
      )
    )
    .get();
  return row ? toArtifact(row) : undefined;
}

export interface RecordArtifactInput {
  relativePath: string;
  artifactType: MediaServerArtifactType;
  materialization: MediaServerMaterialization;
  showId?: string;
  assignmentId?: string;
  sourceAbsolutePath?: string;
  sourceSize?: number;
  sourceMtimeMs?: number;
  contentDigest?: string;
}

/**
 * Records ownership of a published path.
 *
 * Call this only AFTER the atomic rename succeeded. A ledger row written before
 * publication would claim ownership of a path that may not exist, which is
 * exactly the state cleanup is not allowed to act on.
 */
export function recordArtifact(
  input: RecordArtifactInput
): MediaServerExportArtifact {
  if (!ALLOWED_ARTIFACT_TYPES.has(input.artifactType)) {
    throw new MediaServerArtifactLedgerError(
      "invalid_catalog_assignment",
      `Unknown artifact type "${input.artifactType}".`
    );
  }
  if (!ALLOWED_MATERIALIZATIONS.has(input.materialization)) {
    throw new MediaServerArtifactLedgerError(
      "invalid_catalog_assignment",
      `Unknown materialization "${input.materialization}".`
    );
  }

  const relativePath = normalizeLedgerRelativePath(input.relativePath);
  const now = Date.now();
  const values = {
    relativePath,
    artifactType: input.artifactType,
    showId: input.showId ?? null,
    assignmentId: input.assignmentId ?? null,
    sourceAbsolutePath: input.sourceAbsolutePath ?? null,
    sourceSize: input.sourceSize ?? null,
    sourceMtimeMs: input.sourceMtimeMs ?? null,
    materialization: input.materialization,
    contentDigest: input.contentDigest ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(mediaServerExportArtifacts)
    .values(values)
    .onConflictDoUpdate({
      target: mediaServerExportArtifacts.relativePath,
      set: {
        artifactType: values.artifactType,
        showId: values.showId,
        assignmentId: values.assignmentId,
        sourceAbsolutePath: values.sourceAbsolutePath,
        sourceSize: values.sourceSize,
        sourceMtimeMs: values.sourceMtimeMs,
        materialization: values.materialization,
        contentDigest: values.contentDigest,
        updatedAt: values.updatedAt,
      },
    })
    .run();

  return getArtifact(relativePath) as MediaServerExportArtifact;
}

export function deleteArtifactRecord(relativePath: string): boolean {
  const result = db
    .delete(mediaServerExportArtifacts)
    .where(
      eq(
        mediaServerExportArtifacts.relativePath,
        normalizeLedgerRelativePath(relativePath)
      )
    )
    .run();
  return result.changes > 0;
}

export function deleteArtifactRecordsForAssignment(
  assignmentId: string
): number {
  const result = db
    .delete(mediaServerExportArtifacts)
    .where(eq(mediaServerExportArtifacts.assignmentId, assignmentId))
    .run();
  return result.changes;
}

export function deleteArtifactRecordsForShow(showId: string): number {
  const result = db
    .delete(mediaServerExportArtifacts)
    .where(eq(mediaServerExportArtifacts.showId, showId))
    .run();
  return result.changes;
}

/**
 * True when the on-disk source still matches the fingerprint recorded at
 * publication. Size + mtime is deliberate: hashing every video file on every
 * rebuild would make an offline rebuild cost a full library read.
 */
export function isArtifactSourceUnchanged(
  artifact: MediaServerExportArtifact | undefined,
  sourceAbsolutePath: string,
  sourceSize: number,
  sourceMtimeMs: number
): boolean {
  return Boolean(
    artifact &&
      artifact.sourceAbsolutePath === sourceAbsolutePath &&
      artifact.sourceSize === sourceSize &&
      artifact.sourceMtimeMs === sourceMtimeMs
  );
}
