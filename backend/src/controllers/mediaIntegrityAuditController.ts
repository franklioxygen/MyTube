import { Request, Response } from "express";
import { auditMediaIntegrity } from "../services/mediaIntegrityAuditService";

export const getMediaIntegrityAudit = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Opt-in: it reads whole files and can outlast the API proxy timeout.
  const timeline = ["1", "true"].includes(String(req.query?.timeline ?? "").toLowerCase());
  res.json({
    success: true,
    audit: await auditMediaIntegrity({ timeline }),
  });
};
