import { Request, Response } from "express";
import { auditMediaIntegrity } from "../services/mediaIntegrityAuditService";

export const getMediaIntegrityAudit = async (
  _req: Request,
  res: Response
): Promise<void> => {
  res.json({
    success: true,
    audit: await auditMediaIntegrity(),
  });
};
