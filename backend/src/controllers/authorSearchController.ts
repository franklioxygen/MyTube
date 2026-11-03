import { Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { ValidationError } from "../errors/DownloadErrors";
import { searchBilibiliAuthors, AuthorSearchUnavailableError } from "../services/downloaders/bilibili/bilibiliAuthorSearch";
import { getBilibiliAuthorId } from "../utils/bilibiliAuthor";
import { getClientIp } from "../utils/security";

export const authorSearchLimiter = rateLimit({
  windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)), validate: { trustProxy: false },
});

/** Validate one bounded Bilibili author query and distinguish unavailable searches from empty results. */
export async function searchAuthors(req: Request, res: Response): Promise<void> {
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  if (!query || query.length > 100) throw new ValidationError("Author query must contain 1 to 100 characters", "query");
  if (req.query.source !== "bilibili") throw new ValidationError("Author search supports bilibili", "source");
  const rawPage = req.query.page ?? "1";
  if (typeof rawPage !== "string" || !/^\d+$/.test(rawPage) || Number(rawPage) < 1 || Number(rawPage) > 10) {
    throw new ValidationError("Author search page must be between 1 and 10", "page");
  }
  // A URL or numeric input is a precise lookup, never a fuzzy keyword fallback.
  if ((/^\d+$/.test(query) || /^(?:https?:\/\/|space\.bilibili\.com)/i.test(query)) && !getBilibiliAuthorId(query)) {
    throw new ValidationError("Enter a valid Bilibili UID or profile URL", "query");
  }
  try {
    res.json(await searchBilibiliAuthors(query, Number(rawPage)));
  } catch (error) {
    if (!(error instanceof AuthorSearchUnavailableError)) throw error;
    res.status(502).json({ error: error.message, code: error.code });
  }
}
