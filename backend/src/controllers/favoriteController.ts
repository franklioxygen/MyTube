import { Request, Response } from "express";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import * as favoriteService from "../services/favoriteService";
import * as storageService from "../services/storageService";
import { getVisibilityScopedRole } from "./video/visibility";
import { getStringParam } from "../utils/paramUtils";

const UNAUTHORIZED_MESSAGE =
  "Authentication required. Please log in to access favorites.";

const getFavoriteUserId = (req: Request, res: Response): string | null => {
  const userId = favoriteService.resolveFavoriteUserId(req);
  if (userId) {
    return userId;
  }

  res.status(401).json({ success: false, error: UNAUTHORIZED_MESSAGE });
  return null;
};

const validateRequiredString = (
  value: unknown,
  field: string,
  maxLength: number,
): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${field} is required`, field);
  }
  if (value.length > maxLength) {
    throw new ValidationError(`${field} must be at most ${maxLength} characters`, field);
  }
  return value;
};

const validateOptionalString = (
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, field);
  }
  if (value.length > maxLength) {
    throw new ValidationError(`${field} must be at most ${maxLength} characters`, field);
  }
  return value;
};

const validateChannelUrl = (value: string | undefined): string | undefined => {
  if (!value) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new ValidationError("channelUrl must be a valid http(s) URL", "channelUrl");
  }

  return value;
};

export const getFavoriteCollections = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = getFavoriteUserId(req, res);
  if (!userId) return;

  res.json(
    favoriteService.listFavoriteCollections(
      userId,
      getVisibilityScopedRole(req),
    ),
  );
};

export const addFavoriteCollection = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = getFavoriteUserId(req, res);
  if (!userId) return;

  const collectionId = validateRequiredString(
    getStringParam(req.params.id),
    "collectionId",
    64,
  );
  if (!storageService.getCollectionById(collectionId)) {
    throw new NotFoundError("Collection", collectionId);
  }

  favoriteService.addFavoriteCollection(userId, collectionId);
  res.status(201).json({ success: true });
};

export const removeFavoriteCollection = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = getFavoriteUserId(req, res);
  if (!userId) return;

  const collectionId = validateRequiredString(
    getStringParam(req.params.id),
    "collectionId",
    64,
  );
  favoriteService.removeFavoriteCollection(userId, collectionId);
  res.json({ success: true });
};

export const getFavoriteAuthors = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = getFavoriteUserId(req, res);
  if (!userId) return;

  res.json(
    favoriteService.listFavoriteAuthors(userId, getVisibilityScopedRole(req)),
  );
};

export const addFavoriteAuthor = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = getFavoriteUserId(req, res);
  if (!userId) return;

  const body = req.body ?? {};
  const author = validateRequiredString(body.author, "author", 200);
  const displayName = validateOptionalString(body.displayName, "displayName", 500);
  const avatarPath = validateOptionalString(body.avatarPath, "avatarPath", 500);
  const channelUrl = validateChannelUrl(
    validateOptionalString(body.channelUrl, "channelUrl", 2000),
  );

  favoriteService.addFavoriteAuthor(userId, {
    author,
    displayName,
    avatarPath,
    channelUrl,
  });
  res.status(201).json({ success: true });
};

export const removeFavoriteAuthor = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = getFavoriteUserId(req, res);
  if (!userId) return;

  const author = validateRequiredString(req.body?.author, "author", 200);
  favoriteService.removeFavoriteAuthor(userId, author);
  res.json({ success: true });
};
