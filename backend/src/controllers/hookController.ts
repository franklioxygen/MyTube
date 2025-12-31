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

  // Scan for risk commands
  const riskCommand = scanForRiskCommands(req.file.path);
  if (riskCommand) {
    // Delete the file immediately
    require("fs").unlinkSync(req.file.path);
    throw new ValidationError(
      `Risk command detected: ${riskCommand}. Upload rejected.`,
      "file"
    );
  }

  HookService.uploadHook(name, req.file.path);
  res.json(successMessage(`Hook ${name} uploaded successfully`));
};

/**
 * Scan file for risk commands
 */
const scanForRiskCommands = (filePath: string): string | null => {
  const fs = require("fs");
  const content = fs.readFileSync(filePath, "utf-8");

  // List of risky patterns
  // We use regex to match commands, trying to avoid false positives in comments if possible,
  // but for safety, even commented dangerous commands might be flagged or we just accept strictness.
  // A simple include check is safer for now.
  const riskyPatterns = [
    { pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|-[a-zA-Z]*f[a-zA-Z]*\s+)*-?[rf][a-zA-Z]*\s+.*[\/\*]/, name: "rm -rf / (recursive delete)" }, // Matches rm -rf /, rm -fr *, etc roughly
    { pattern: /mkfs/, name: "mkfs (format disk)" },
    { pattern: /dd\s+if=/, name: "dd (disk write)" },
    { pattern: /:[:\(\)\{\}\s|&]+;:/, name: "fork bomb" },
    { pattern: />\s*\/dev\/sd/, name: "write to block device" },
    { pattern: />\s*\/dev\/nvme/, name: "write to block device" },
    { pattern: /mv\s+.*[\s\/]+\//, name: "mv to root" }, // deeply simplified, but mv / is dangerous
    { pattern: /chmod\s+.*777\s+\//, name: "chmod 777 root" },
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
