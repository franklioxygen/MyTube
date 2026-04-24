import { Request, Response } from "express";
import { ValidationError, NotFoundError } from "../errors/DownloadErrors";
import * as storageService from "../services/storageService";
import * as rssService from "../services/rssService";
import { logger } from "../utils/logger";

function getLanguage(): string | undefined {
  try {
    const settings = storageService.getSettings();
    return typeof settings.language === "string" ? settings.language : undefined;
  } catch {
    return undefined;
  }
}

function buildFeedUrl(req: Request, tokenId: string): string {
  return `${rssService.getBaseUrl(req)}/feed/${tokenId}`;
}

function formatToken(token: rssService.RssToken, req: Request) {
  return {
    id: token.id,
    label: token.label,
    role: token.role,
    filters: token.filters,
    isActive: token.isActive,
    accessCount: token.accessCount,
    lastAccessedAt: token.lastAccessedAt,
    createdAt: token.createdAt,
    feedUrl: buildFeedUrl(req, token.id),
  };
}

function sendRssXmlResponse(
  res: Response,
  status: number,
  xml: string
): void {
  res.status(status).type("application/rss+xml; charset=utf-8").send(xml);
}

export async function listTokens(req: Request, res: Response): Promise<void> {
  const tokens = await rssService.listRssTokens();
  res.json({ tokens: tokens.map((t) => formatToken(t, req)) });
}

export async function createToken(req: Request, res: Response): Promise<void> {
  const { label, role, filters } = req.body as {
    label?: unknown;
    role?: unknown;
    filters?: unknown;
  };

  if (label !== undefined && typeof label !== "string") {
    throw new ValidationError("label must be a string", "label");
  }

  if (role !== undefined && !rssService.validateRole(role)) {
    throw new ValidationError('Role must be "admin" or "visitor"', "role");
  }

  const validatedRole = (role as "admin" | "visitor" | undefined) ?? "visitor";

  const token = await rssService.createRssToken({
    label: label ?? "",
    role: validatedRole,
    filters: (filters as rssService.RssFilters | undefined) ?? {},
  });

  res.status(201).json({ token: formatToken(token, req) });
}

export async function updateToken(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { label, filters, isActive } = req.body as {
    label?: unknown;
    filters?: unknown;
    isActive?: unknown;
  };

  if (label !== undefined && typeof label !== "string") {
    throw new ValidationError("label must be a string", "label");
  }

  if (isActive !== undefined && typeof isActive !== "boolean") {
    throw new ValidationError("isActive must be a boolean", "isActive");
  }

  const patch: rssService.UpdateTokenInput = {};
  if (label !== undefined) patch.label = label;
  if (filters !== undefined) patch.filters = filters as rssService.RssFilters;
  if (isActive !== undefined) patch.isActive = isActive;

  const token = await rssService.updateRssToken(id, patch);
  if (!token) throw new NotFoundError("RSS token");

  res.json({ token: formatToken(token, req) });
}

export async function deleteToken(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const deleted = await rssService.deleteRssToken(id);
  if (!deleted) throw new NotFoundError("RSS token");
  res.status(204).end();
}

export async function resetToken(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const result = await rssService.resetRssToken(id);
  if (!result) throw new NotFoundError("RSS token");
  res.json({
    oldId: result.oldId,
    token: formatToken(result.token, req),
  });
}

export async function serveFeed(req: Request, res: Response): Promise<void> {
  const { token: tokenId } = req.params;
  const baseUrl = rssService.getBaseUrl(req);

  const sendError = (status: number, title: string, description: string) => {
    rssService.setRssNoStoreHeaders(res);
    sendRssXmlResponse(
      res,
      status,
      rssService.buildErrorRssXml({ title, link: baseUrl, description })
    );
  };

  if (!tokenId || typeof tokenId !== "string" || tokenId.length < 10) {
    sendError(404, "Error", "Feed not found or disabled");
    return;
  }

  const token = await rssService.getRssToken(tokenId);
  if (!token || !token.isActive) {
    sendError(404, "Error", "Feed not found or disabled");
    return;
  }

  const videoList = await rssService.getVideosForRss(token.filters, token.role);
  const language = getLanguage();
  const xml = rssService.buildRssXml(videoList, token, baseUrl, { language });

  void rssService.recordAccess(tokenId).catch((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn("Failed to record RSS access", {
      tokenId: rssService.rssTokenLogId(tokenId),
      error: error.message,
    });
  });

  rssService.setRssNoStoreHeaders(res);
  sendRssXmlResponse(res, 200, xml);
}
