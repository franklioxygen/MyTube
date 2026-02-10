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

  if (!req.file.buffer || req.file.buffer.length === 0) {
    throw new ValidationError("Uploaded file is empty", "file");
  }

  // Scan for risk commands
  const riskCommand = scanForRiskCommands(req.file.buffer.toString("utf-8"));
  if (riskCommand) {
    throw new ValidationError(
      `Risk command detected: ${riskCommand}. Upload rejected.`,
      "file"
    );
  }

  HookService.uploadHook(name, req.file.buffer);
  res.json(successMessage(`Hook ${name} uploaded successfully`));
};

/**
 * Scan file for risk commands
 * @param content - Hook script content
 */
const scanForRiskCommands = (content: string): string | null => {
  // List of risky patterns
  // Use simpler, more specific patterns to avoid ReDoS (Regular Expression Denial of Service)
  // Avoid nested quantifiers and complex alternations that can cause exponential backtracking
  const riskyPatterns = [
    // Check for rm -rf / or rm -fr / with simpler pattern
    { pattern: /rm\s+-[rf]+\s+\//, name: "rm -rf / (recursive delete)" },
    { pattern: /rm\s+-[fr]+\s+\//, name: "rm -fr / (recursive delete)" },
    { pattern: /rm\s+-r\s+-f\s+\//, name: "rm -r -f / (recursive delete)" },
    { pattern: /rm\s+-f\s+-r\s+\//, name: "rm -f -r / (recursive delete)" },
    { pattern: /rm\s+-rf\s+\*/, name: "rm -rf * (recursive delete all)" },
    { pattern: /rm\s+-fr\s+\*/, name: "rm -fr * (recursive delete all)" },
    { pattern: /mkfs/, name: "mkfs (format disk)" },
    { pattern: /dd\s+if=/, name: "dd (disk write)" },
    // Simplified fork bomb pattern - avoid nested quantifiers
    { pattern: /::\s*;:/, name: "fork bomb" },
    { pattern: />\s*\/dev\/sd/, name: "write to block device" },
    { pattern: />\s*\/dev\/nvme/, name: "write to block device" },
    // Simplified mv pattern
    { pattern: /mv\s+[^\s]+\s+\//, name: "mv to root" },
    { pattern: /chmod\s+777\s+\//, name: "chmod 777 root" },
    { pattern: /wget\s+http/, name: "wget (potential malware download)" },
    { pattern: /curl\s+http/, name: "curl (potential malware download)" },
  ];

  for (const risk of riskyPatterns) {
    if (risk.pattern.test(content)) {
      return risk.name;
    }
  }

  return null;
};

/**
 * Delete hook script
 */
export const deleteHook = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { name } = req.params;
  
  // Validate hook name to prevent path traversal
  const validHooks = [
    "task_before_start",
    "task_success",
    "task_fail",
    "task_cancel",
  ];
  if (!validHooks.includes(name)) {
    throw new ValidationError("Invalid hook name", "name");
  }
  
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
