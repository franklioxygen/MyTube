import { Request, Response } from "express";
import { auditMediaCollisions } from "../services/mediaCollisionAuditService";
import { repairMediaCollisionFinding } from "../services/mediaCollisionRepairService";

export const getMediaCollisionAudit = async (
  _req: Request,
  res: Response
): Promise<void> => {
  res.json({
    success: true,
    audit: auditMediaCollisions(),
  });
};

export const repairMediaCollisionAuditFinding = async (
  req: Request,
  res: Response
): Promise<void> => {
  const result = await repairMediaCollisionFinding({
    localVideoId: req.body?.localVideoId,
    action: req.body?.action,
    confirm: req.body?.confirm === true,
  });

  res.json({
    success: true,
    repair: result,
  });
};
