import { Request, Response } from "express";
import {
  createAdminTrustLevelError,
  isAdminTrustLevelAtLeast,
} from "../config/adminTrust";
import { ValidationError } from "../errors/DownloadErrors";
import { HookService } from "../services/hookService";
import { sendNotFound, successMessage } from "../utils/response";

const ensureHookAccess = (res: Response): boolean => {
  if (isAdminTrustLevelAtLeast("container")) {
    return true;
  }

  res.status(403).json(createAdminTrustLevelError("container"));
  return false;
};

/**
 * Upload hook script
 */
export const uploadHook = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!ensureHookAccess(res)) {
    return;
  }

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
  // Best-effort upload safeguard only; this is not a complete security boundary.
  // The primary protection is deployment trust-level gating.
  // Keep patterns simple to avoid ReDoS from complex regular expressions.
  // Use simpler, more specific patterns to avoid ReDoS (Regular Expression Denial of Service)
  // Avoid nested quantifiers and complex alternations that can cause exponential backtracking
  const riskyPatterns = [
    { pattern: /rm\s+-[rf]+\s+\//, name: "rm -rf / (destructive delete)" },
    { pattern: /rm\s+-[rf]+\s+\*/, name: "rm -rf * (destructive delete)" },
    { pattern: /rm\s+-[rf]+\s+~(?:\/|\b)/, name: "rm -rf ~ (destructive delete)" },
    {
      pattern: /rm\s+-[rf]+\s+(?:\$HOME|\$\{HOME\})(?:\/|\b)/,
      name: "rm -rf $HOME (destructive delete)",
    },
    { pattern: /rm\s+-[fr]+\s+\//, name: "rm -fr / (destructive delete)" },
    { pattern: /rm\s+-[fr]+\s+\*/, name: "rm -fr * (destructive delete)" },
    { pattern: /rm\s+-[fr]+\s+~(?:\/|\b)/, name: "rm -fr ~ (destructive delete)" },
    {
      pattern: /rm\s+-[fr]+\s+(?:\$HOME|\$\{HOME\})(?:\/|\b)/,
      name: "rm -fr $HOME (destructive delete)",
    },
    { pattern: /rm\s+-r\s+-f\s+\//, name: "rm -r -f / (destructive delete)" },
    { pattern: /rm\s+-r\s+-f\s+\*/, name: "rm -r -f * (destructive delete)" },
    {
      pattern: /rm\s+-r\s+-f\s+~(?:\/|\b)/,
      name: "rm -r -f ~ (destructive delete)",
    },
    {
      pattern: /rm\s+-r\s+-f\s+(?:\$HOME|\$\{HOME\})(?:\/|\b)/,
      name: "rm -r -f $HOME (destructive delete)",
    },
    { pattern: /rm\s+-f\s+-r\s+\//, name: "rm -f -r / (destructive delete)" },
    { pattern: /rm\s+-f\s+-r\s+\*/, name: "rm -f -r * (destructive delete)" },
    {
      pattern: /rm\s+-f\s+-r\s+~(?:\/|\b)/,
      name: "rm -f -r ~ (destructive delete)",
    },
    {
      pattern: /rm\s+-f\s+-r\s+(?:\$HOME|\$\{HOME\})(?:\/|\b)/,
      name: "rm -f -r $HOME (destructive delete)",
    },
    {
      pattern: /rm\s+--recursive\s+--force\s+\//,
      name: "rm --recursive --force / (destructive delete)",
    },
    {
      pattern: /rm\s+--recursive\s+--force\s+\*/,
      name: "rm --recursive --force * (destructive delete)",
    },
    {
      pattern: /rm\s+--recursive\s+--force\s+~(?:\/|\b)/,
      name: "rm --recursive --force ~ (destructive delete)",
    },
    {
      pattern: /rm\s+--recursive\s+--force\s+(?:\$HOME|\$\{HOME\})(?:\/|\b)/,
      name: "rm --recursive --force $HOME (destructive delete)",
    },
    {
      pattern: /rm\s+--force\s+--recursive\s+\//,
      name: "rm --force --recursive / (destructive delete)",
    },
    {
      pattern: /rm\s+--force\s+--recursive\s+\*/,
      name: "rm --force --recursive * (destructive delete)",
    },
    {
      pattern: /rm\s+--force\s+--recursive\s+~(?:\/|\b)/,
      name: "rm --force --recursive ~ (destructive delete)",
    },
    {
      pattern: /rm\s+--force\s+--recursive\s+(?:\$HOME|\$\{HOME\})(?:\/|\b)/,
      name: "rm --force --recursive $HOME (destructive delete)",
    },
    { pattern: /mkfs/, name: "mkfs (format disk)" },
    { pattern: /dd\s+if=/, name: "dd (disk write)" },
    {
      pattern: /dd\b[^\n]{0,120}\bof=\/dev\/(?:sd|nvme)/,
      name: "dd to block device",
    },
    // Simplified fork bomb pattern - avoid nested quantifiers
    { pattern: /::\s*;:/, name: "fork bomb" },
    { pattern: /[.:]\s*\(\)\s*\{\s*[.:]\s*\|/, name: "fork bomb" },
    { pattern: />\s*\/dev\/sd/, name: "write to block device" },
    { pattern: />\s*\/dev\/nvme/, name: "write to block device" },
    // Simplified mv pattern
    { pattern: /mv\s+[^\s]+\s+\//, name: "mv to root" },
    { pattern: /chmod\s+777\s+\//, name: "chmod 777 root" },
    { pattern: /wget\s+\S+:\/\//, name: "wget (potential malware download)" },
    {
      pattern: /wget\b[^\n]{0,240}\|\s*(?:bash|sh)\b/,
      name: "wget piped to shell",
    },
    {
      pattern: /curl\b[^\n]{0,200}\b(?:https?|ftp):\/\//,
      name: "curl (potential malware download)",
    },
    {
      pattern: /curl\b[^\n]{0,240}\|\s*(?:bash|sh)\b/,
      name: "curl piped to shell",
    },
    {
      pattern: /(?:base64|openssl\s+base64)\b[^\n]{0,240}\|\s*(?:bash|sh)\b/,
      name: "decoded payload piped to shell",
    },
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
  if (!ensureHookAccess(res)) {
    return;
  }

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
    sendNotFound(res, "Hook not found");
  }
};

/**
 * Get hooks status
 */
export const getHookStatus = async (
  _req: Request,
  res: Response
): Promise<void> => {
  if (!ensureHookAccess(res)) {
    return;
  }

  const status = HookService.getHookStatus();
  res.json(status);
};
