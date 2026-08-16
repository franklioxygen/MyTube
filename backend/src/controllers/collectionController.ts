import { Request, Response } from "express";
import {
  DuplicateError,
  NotFoundError,
  ValidationError,
} from "../errors/DownloadErrors";
import * as storageService from "../services/storageService";
import { Collection } from "../services/storageService";
import { getStringParam } from "../utils/paramUtils";
import { successMessage } from "../utils/response";

/**
 * Search TMDB for a collection's show identity.
 *
 * Read-only: it never downloads a poster and never persists anything. The
 * response carries no credential and the candidate list is bounded by the
 * service.
 */
export const searchCollectionTmdb = async (
  req: Request,
  res: Response
): Promise<void> => {
  const collectionId = getStringParam(req.params.id) ?? "";
  const collection = storageService.getCollectionById(collectionId);
  if (!collection) {
    throw new NotFoundError(`Collection not found: ${collectionId}`);
  }

  const body = (req.body || {}) as { query?: unknown };
  const query =
    typeof body.query === "string" && body.query.trim()
      ? body.query.trim()
      : collection.title || collection.name || "";

  if (!query) {
    throw new ValidationError("A search query is required.", "query");
  }
  if (query.length > 200) {
    throw new ValidationError("Search query is too long.", "query");
  }

  const { searchCollectionCandidates } = await import(
    "../services/tmdbService/collectionSearch"
  );
  const result = await searchCollectionCandidates(query);

  if (result.status === "no_credential") {
    res.json({ status: "no_credential", candidates: [] });
    return;
  }
  if (result.status === "no_results") {
    res.json({ status: "no_results", candidates: [] });
    return;
  }

  res.json({ status: "ok", candidates: result.candidates });
};

/** A collection plus the show folder the reconciler actually allocated for it. */
type CollectionWithShowDirectory = Collection & {
  mediaServerShowDirectoryName?: string;
};

/**
 * Attaches the persisted show directory name to collections exported as their
 * own show.
 *
 * A show's directory is allocated once from the accepted title and is never
 * renamed afterwards, so sanitization or a de-duplication suffix can make it
 * differ from the title. The UI must therefore show this stored name rather
 * than re-deriving a preview.
 */
async function withShowDirectoryNames(
  list: Collection[]
): Promise<CollectionWithShowDirectory[]> {
  // Keeps the catalog module out of the collection list path entirely for
  // deployments that never opted in.
  if (!list.some((collection) => collection.exportAsShow)) {
    return list;
  }

  const { listMediaServerShows } = await import(
    "../services/mediaServerExport/catalogRepository"
  );
  const directoryByCollection = new Map<string, string>();
  for (const show of listMediaServerShows()) {
    if (show.sourceCollectionId) {
      directoryByCollection.set(show.sourceCollectionId, show.directoryName);
    }
  }

  return list.map((collection) => {
    const directoryName = collection.exportAsShow
      ? directoryByCollection.get(collection.id)
      : undefined;
    return directoryName
      ? { ...collection, mediaServerShowDirectoryName: directoryName }
      : collection;
  });
}

type ShowExportRequest = {
  enabled?: unknown;
  mode?: unknown;
  title?: unknown;
  description?: unknown;
  tmdbId?: unknown;
  mediaType?: unknown;
};

const ACTIVATION_ERROR_STATUS: Record<string, number> = {
  layout_not_playlist_tv: 409,
  collection_not_found: 404,
  lock_unavailable: 409,
  tmdb_unavailable: 502,
  invalid_title: 400,
};

/**
 * Marks or unmarks a collection as its own media-server show.
 *
 * Activation takes exactly one metadata mode. The whole request is validated
 * before anything is written, because activation allocates an immutable show
 * directory from the accepted title.
 */
export const updateCollectionShowExport = async (
  req: Request,
  res: Response
): Promise<void> => {
  const collectionId = getStringParam(req.params.id) ?? "";
  const body = (req.body || {}) as ShowExportRequest;

  const allowedKeys = new Set([
    "enabled",
    "mode",
    "title",
    "description",
    "tmdbId",
    "mediaType",
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      throw new ValidationError(`Unknown field: ${key}`, key);
    }
  }

  if (typeof body.enabled !== "boolean") {
    throw new ValidationError("`enabled` must be a boolean.", "enabled");
  }

  const {
    activateCollectionShow,
    deactivateCollectionShow,
  } = await import("../services/mediaServerExport/collectionShowActivation");

  if (!body.enabled) {
    const result = await deactivateCollectionShow(collectionId);
    if (result.status === "error") {
      res
        .status(ACTIVATION_ERROR_STATUS[result.reason] ?? 400)
        .json({ error: result.reason, code: result.reason });
      return;
    }
    const [collection] = await withShowDirectoryNames([result.collection]);
    res.json({ collection });
    return;
  }

  if (body.mode !== "collection" && body.mode !== "manual" && body.mode !== "tmdb") {
    throw new ValidationError(
      "`mode` must be one of: collection, manual, tmdb.",
      "mode"
    );
  }

  let mode:
    | { kind: "collection" }
    | { kind: "manual"; title: string; description?: string }
    | { kind: "tmdb"; tmdbId: number; mediaType: "tv" | "movie" };

  if (body.mode === "collection") {
    mode = { kind: "collection" };
  } else if (body.mode === "manual") {
    if (typeof body.title !== "string" || !body.title.trim()) {
      throw new ValidationError("A title is required.", "title");
    }
    if (body.title.length > 200) {
      throw new ValidationError("Title is too long.", "title");
    }
    if (body.description !== undefined && typeof body.description !== "string") {
      throw new ValidationError("`description` must be a string.", "description");
    }
    mode = {
      kind: "manual",
      title: body.title,
      description:
        typeof body.description === "string" ? body.description : undefined,
    };
  } else {
    if (
      typeof body.tmdbId !== "number" ||
      !Number.isSafeInteger(body.tmdbId) ||
      body.tmdbId <= 0
    ) {
      throw new ValidationError("`tmdbId` must be a positive integer.", "tmdbId");
    }
    if (body.mediaType !== "tv" && body.mediaType !== "movie") {
      throw new ValidationError(
        "`mediaType` must be `tv` or `movie`.",
        "mediaType"
      );
    }
    mode = { kind: "tmdb", tmdbId: body.tmdbId, mediaType: body.mediaType };
  }

  const result = await activateCollectionShow(collectionId, mode);
  if (result.status === "error") {
    res
      .status(ACTIVATION_ERROR_STATUS[result.reason] ?? 400)
      .json({ error: result.reason, code: result.reason });
    return;
  }

  const [collection] = await withShowDirectoryNames([result.collection]);
  res.json({
    collection,
    posterWarning: result.posterWarning ?? false,
  });
};

/**
 * Get all collections
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns array directly for backward compatibility with frontend
 */
export const getCollections = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const collections = storageService.getCollections();
  // Return array directly for backward compatibility (frontend expects response.data to be Collection[])
  res.json(await withShowDirectoryNames(collections));
};

/**
 * Create a new collection
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns collection object directly for backward compatibility with frontend
 */
export const createCollection = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { name, videoId } = req.body;

  if (!name) {
    throw new ValidationError("Collection name is required", "name");
  }

  // Collection names must be unique.
  const existing = storageService.getCollectionByName(name);
  if (existing) {
    // If a video is being added, merge it into the existing collection
    // instead of creating a duplicate. Signalled with 200 (vs 201 for a new
    // collection) so the frontend can tell the user it was added to an
    // existing collection.
    if (videoId) {
      const updatedCollection = storageService.addVideoToCollection(
        existing.id,
        videoId,
        { moveFiles: false }
      );
      res.status(200).json(updatedCollection ?? existing);
      return;
    }

    throw new DuplicateError(
      "Collection",
      `Collection name "${name}" already exists`
    );
  }

  // Create a new collection
  const newCollection: Collection = {
    id: Date.now().toString(),
    name,
    videos: [], // Initialize with empty videos
    origin: "manual",
    createdAt: new Date().toISOString(),
    title: name, // Ensure title is also set as it's required by the interface
  };

  // Save the new collection
  storageService.saveCollection(newCollection);

  // If videoId is provided, add it as an additional collection membership
  if (videoId) {
    const updatedCollection = storageService.addVideoToCollection(
      newCollection.id,
      videoId,
      { moveFiles: false }
    );
    if (updatedCollection) {
      // Return collection object directly for backward compatibility
      res.status(201).json(updatedCollection);
      return;
    }
  }

  // Return collection object directly for backward compatibility
  res.status(201).json(newCollection);
};

/**
 * Update a collection
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns collection object directly for backward compatibility with frontend
 */
export const updateCollection = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = getStringParam(req.params.id) ?? "";
  const { name, videoId, action } = req.body;

  let updatedCollection: Collection | null | undefined;

  // Handle name update first
  if (name) {
    updatedCollection = storageService.renameCollection(id, name);
  }

  // Handle video add/remove
  if (videoId) {
    if (action === "add") {
      updatedCollection = storageService.addVideoToCollection(id, videoId, {
        moveFiles: false,
      });
    } else if (action === "remove") {
      updatedCollection = storageService.removeVideoFromCollection(id, videoId, {
        moveFiles: false,
      });
    }
  }

  // If no changes requested but id exists, return current collection
  if (!name && !videoId) {
    updatedCollection = storageService.getCollectionById(id);
  }

  if (!updatedCollection) {
    throw new NotFoundError("Collection", id);
  }

  // Return collection object directly for backward compatibility
  res.json(updatedCollection);
};

/**
 * Delete a collection
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteCollection = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = getStringParam(req.params.id) ?? "";
  const deleteVideos = getStringParam(req.query.deleteVideos);

  let success = false;

  // If deleteVideos is true, delete all videos in the collection first
  if (deleteVideos === "true") {
    success = storageService.deleteCollectionAndVideos(id);
  } else {
    // Default: Move files back to root/other, then delete collection
    success = storageService.deleteCollectionWithFiles(id);
  }

  if (!success) {
    throw new NotFoundError("Collection", id);
  }

  res.json(successMessage("Collection deleted successfully"));
};
