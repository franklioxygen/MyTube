import { Request, Response } from "express";
import { ValidationError } from "../errors/DownloadErrors";
import { HookService } from "../services/hookService";
import { successMessage } from "../utils/response";

/**
 * Upload hook script
 */
export const uploadHook = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { name } = req.params;

  if (!req.file) {
    throw new ValidationError("No file uploaded", "file");
  }

  // Basic validation of hook name
  const validHooks = [
    "task_before_start",
    "task_success",
    "task_fail",
    "task_cancel",
  ];

  if (!validHooks.includes(name)) {
    throw new ValidationError("Invalid hook name", "name");
  }

  HookService.uploadHook(name, req.file.path);
  res.json(successMessage(`Hook ${name} uploaded successfully`));
};

/**
 * Delete hook script
 */
export const deleteHook = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { name } = req.params;
  const deleted = HookService.deleteHook(name);
  
  if (deleted) {
    res.json(successMessage(`Hook ${name} deleted successfully`));
  } else {
     // If not found, we can still consider it "success" as the desired state is reached,
     // or return 404. For idempotency, success is often fine, but let's be explicit.
     res.status(404).json({ success: false, message: "Hook not found" });
  }
};

/**
 * Get hooks status
 */
export const getHookStatus = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const status = HookService.getHookStatus();
  res.json(status);
};
