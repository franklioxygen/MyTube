import type { Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { getSponsorBlockSegments } from "../services/sponsorBlock/service";
import { getVideoById } from "../services/storageService/videos";
import { getClientIp } from "../utils/security";
import { getVisibilityScopedRole } from "./video/visibility";

// Unlike the danmaku reads, a cache miss here reaches a third party, and
// visitors can trigger it, so the route is limited per client like author search.
export const sponsorBlockLimiter = rateLimit({
  windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)), validate: { trustProxy: false },
});

/** SponsorBlock segments for a library video the requester can see (issue #555). */
export async function read(req: Request, res: Response): Promise<void> {
  res.set("Cache-Control", "private, no-store");
  const video = getVideoById(String(req.params.id), getVisibilityScopedRole(req));
  if (!video) {
    res.status(404).json({ error: "sponsorBlockVideoNotFound" });
    return;
  }
  res.json(await getSponsorBlockSegments(video));
}
