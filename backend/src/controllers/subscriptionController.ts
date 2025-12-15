import { Request, Response } from "express";
import { ValidationError } from "../errors/DownloadErrors";
import { subscriptionService } from "../services/subscriptionService";
import { logger } from "../utils/logger";
import { successMessage, successResponse } from "../utils/response";

/**
 * Create a new subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const createSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url, interval } = req.body;
  logger.info("Creating subscription:", { url, interval });

  if (!url || !interval) {
    throw new ValidationError("URL and interval are required", "body");
  }

  const subscription = await subscriptionService.subscribe(
    url,
    parseInt(interval)
  );
  res.status(201).json(successResponse(subscription, "Subscription created"));
};

/**
 * Get all subscriptions
 * Errors are automatically handled by asyncHandler middleware
 */
export const getSubscriptions = async (
  req: Request,
  res: Response
): Promise<void> => {
  const subscriptions = await subscriptionService.listSubscriptions();
  res.json(successResponse(subscriptions));
};

/**
 * Delete a subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  await subscriptionService.unsubscribe(id);
  res.status(200).json(successMessage("Subscription deleted"));
};
