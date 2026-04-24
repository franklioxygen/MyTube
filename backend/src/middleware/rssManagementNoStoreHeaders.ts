import { NextFunction, Request, Response } from "express";
import { setRssManagementNoStoreHeaders } from "../services/rssService";

const RSS_MANAGEMENT_PATH = "/api/rss/tokens";

function isRssManagementPath(req: Request): boolean {
  return (
    req.path === RSS_MANAGEMENT_PATH ||
    req.path.startsWith(`${RSS_MANAGEMENT_PATH}/`)
  );
}

export function rssManagementNoStoreHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (isRssManagementPath(req)) {
    setRssManagementNoStoreHeaders(res);
  }

  next();
}
