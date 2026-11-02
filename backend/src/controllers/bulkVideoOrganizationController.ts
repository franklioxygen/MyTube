import { Request, Response } from "express";
import {
  addVideosToCollection, appendTagsToVideos, BulkOrganizationError,
} from "../services/bulkVideoOrganizationService";
import { queueBulkArtifactRefresh } from "../services/mediaServerExport/bulkArtifactRefresh";
import { errorResponse, successResponse } from "../utils/response";

function handleError(error: unknown, res: Response): void {
  if (!(error instanceof BulkOrganizationError)) throw error;
  const type = error.status === 404 ? "not_found" : error.status === 409 ? "conflict" : "validation";
  res.status(error.status).json(errorResponse(error.message, { type, details: error.details }));
}

export async function addTags(req: Request, res: Response): Promise<void> {
  try {
    const result = appendTagsToVideos(req.body);
    res.json(successResponse(result));
    queueBulkArtifactRefresh(result.changedVideoIds);
  } catch (error) {
    handleError(error, res);
  }
}

export async function addToCollection(req: Request, res: Response): Promise<void> {
  try {
    res.json(successResponse(addVideosToCollection(req.body)));
  } catch (error) {
    handleError(error, res);
  }
}
