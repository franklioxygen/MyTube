import { Request, Response } from "express";
import { getRecommendationSignals } from "../services/recommendationSignalsService";
import { getVisibilityScopedRole } from "./video/visibility";

export const getRecommendationSignalsEndpoint = async (
  req: Request,
  res: Response
): Promise<void> => {
  const signals = getRecommendationSignals(getVisibilityScopedRole(req));

  if (!signals) {
    res.status(204).end();
    return;
  }

  res.set("Cache-Control", "private, max-age=300");
  res.json(signals);
};
