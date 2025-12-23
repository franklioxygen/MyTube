import { Request, Response } from "express";
import { ValidationError } from "../errors/DownloadErrors";
import { continuousDownloadService } from "../services/continuousDownloadService";
import { subscriptionService } from "../services/subscriptionService";
import { logger } from "../utils/logger";
import { successMessage } from "../utils/response";

/**
 * Create a new subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const createSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url, interval, authorName, downloadAllPrevious } = req.body;
  logger.info("Creating subscription:", {
    url,
    interval,
    authorName,
    downloadAllPrevious,
  });

  if (!url || !interval) {
    throw new ValidationError("URL and interval are required", "body");
  }

  const subscription = await subscriptionService.subscribe(
    url,
    parseInt(interval),
    authorName
  );

  // If user wants to download all previous videos, create a continuous download task
  if (downloadAllPrevious) {
    try {
      await continuousDownloadService.createTask(
        url,
        subscription.author,
        subscription.platform,
        subscription.id
      );
      logger.info(
        `Created continuous download task for subscription ${subscription.id}`
      );
    } catch (error) {
      logger.error(
        "Error creating continuous download task:",
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't fail the subscription creation if task creation fails
    }
  }

  // Return subscription object directly for backward compatibility
  res.status(201).json(subscription);
};

/**
 * Get all subscriptions
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns array directly for backward compatibility with frontend
 */
export const getSubscriptions = async (
  req: Request,
  res: Response
): Promise<void> => {
  const subscriptions = await subscriptionService.listSubscriptions();
  // Return array directly for backward compatibility (frontend expects response.data to be Subscription[])
  res.json(subscriptions);
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

/**
 * Get all continuous download tasks
 * Errors are automatically handled by asyncHandler middleware
 */
export const getContinuousDownloadTasks = async (
  req: Request,
  res: Response
): Promise<void> => {
  const tasks = await continuousDownloadService.getAllTasks();
  res.json(tasks);
};

/**
 * Cancel a continuous download task
 * Errors are automatically handled by asyncHandler middleware
 */
export const cancelContinuousDownloadTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  await continuousDownloadService.cancelTask(id);
  res.status(200).json(successMessage("Task cancelled"));
};

/**
 * Delete a continuous download task
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteContinuousDownloadTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  await continuousDownloadService.deleteTask(id);
  res.status(200).json(successMessage("Task deleted"));
};
