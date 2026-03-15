import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { HOOKS_DIR } from "../config/paths";
import { isStrictSecurityModel } from "../config/securityModel";
import { recordSecurityAuditEvent } from "./securityAuditService";
import { logger } from "../utils/logger";
import { isPathWithinDirectory } from "../utils/security";
import { isStrictFeatureDisabled } from "../utils/strictSecurity";
import {
  executeNotifyWebhookAction,
  parseNotifyWebhookAction,
  type NotifyWebhookHookAction,
} from "./webhookExecutor";

export interface HookContext {
  taskId: string;
  taskTitle: string;
  sourceUrl?: string;
  status: "start" | "success" | "fail" | "cancel";
  videoPath?: string;
  thumbnailPath?: string;
  error?: string;
}

type HookEventName =
  | "task_before_start"
  | "task_success"
  | "task_fail"
  | "task_cancel";

type HookContextMap = Record<string, string | undefined>;

type HookAction = NotifyWebhookHookAction;

interface HookConfigFile {
  version: 1;
  actions: HookAction[];
}

interface HookQueueItem {
  eventName: HookEventName;
  context: HookContextMap;
  config: HookConfigFile;
  resolve: () => void;
}

type HookUploadFormat = "json" | "shell";

const DECLARATIVE_HOOK_EXTENSION = ".json";
const LEGACY_SCRIPT_EXTENSION = ".sh";
const MAX_HOOK_FILE_SIZE_BYTES = 32 * 1024;
const SHELL_HOOK_TIMEOUT_MS = 30_000;
const SHELL_HOOK_MAX_OUTPUT_BYTES = 256 * 1024;
const VALID_HOOK_EVENTS: readonly HookEventName[] = [
  "task_before_start",
  "task_success",
  "task_fail",
  "task_cancel",
];

const isWorkerExecutionModeEnabled = (): boolean =>
  (process.env.HOOK_EXECUTION_MODE || "").trim().toLowerCase() === "worker";

export class HookService {
  private static queue: HookQueueItem[] = [];
  private static queueProcessing = false;

  /**
   * Initialize hooks directory
   */
  static initialize(): void {
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (!fs.existsSync(HOOKS_DIR)) {
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      fs.mkdirSync(HOOKS_DIR, { recursive: true });
    }
  }

  private static sanitizeHookName(hookName: string): HookEventName {
    const safeName = hookName.trim() as HookEventName;
    if (!VALID_HOOK_EVENTS.includes(safeName)) {
      throw new Error(`Invalid hook name: ${hookName}`);
    }
    return safeName;
  }

  private static validateHookExtension(extension: string): string {
    if (
      extension !== DECLARATIVE_HOOK_EXTENSION &&
      extension !== LEGACY_SCRIPT_EXTENSION
    ) {
      throw new Error(`Unsupported hook extension: ${extension}`);
    }
    return extension;
  }

  private static getSafeHookPath(
    hookName: string,
    extension: string
  ): string {
    const safeHookName = this.sanitizeHookName(hookName);
    const safeExtension = this.validateHookExtension(extension);
    const resolvedHooksDir = path.resolve(HOOKS_DIR);
    // nosemgrep -- hook name and extension are validated against fixed allowlists first
    const hookPath = path.resolve(
      resolvedHooksDir,
      `${safeHookName}${safeExtension}`
    );
    if (!isPathWithinDirectory(hookPath, resolvedHooksDir)) {
      throw new Error("Invalid hook path");
    }
    return hookPath;
  }

  private static hookFileExists(hookPath: string): boolean {
    // nosemgrep -- hookPath comes from getSafeHookPath allowlist validation
    return fs.existsSync(hookPath);
  }

  private static readHookFile(hookPath: string): Buffer {
    // nosemgrep -- hookPath comes from getSafeHookPath allowlist validation
    return fs.readFileSync(hookPath);
  }

  private static writeHookFile(hookPath: string, fileContent: Buffer): void {
    // nosemgrep -- hookPath comes from getSafeHookPath allowlist validation
    fs.writeFileSync(hookPath, fileContent);
  }

  private static removeHookFileIfExists(hookPath: string): boolean {
    if (!this.hookFileExists(hookPath)) {
      return false;
    }
    // nosemgrep -- hookPath comes from getSafeHookPath allowlist validation
    fs.unlinkSync(hookPath);
    return true;
  }

  private static getUploadFormat(originalFilename?: string): HookUploadFormat {
    if (!originalFilename) {
      return "json";
    }

    const normalizedExtension = path.extname(originalFilename).trim().toLowerCase();
    if (normalizedExtension === ".json") {
      return "json";
    }
    if (normalizedExtension === ".sh" || normalizedExtension === ".bash") {
      return "shell";
    }

    throw new Error("Hook file must be .json, .sh, or .bash");
  }

  private static detectRiskCommand(content: string): string | null {
    const riskyPatterns = [
      { pattern: /rm\s+-[rf]+\s+\//, name: "rm -rf / (recursive delete)" },
      { pattern: /rm\s+-[fr]+\s+\//, name: "rm -fr / (recursive delete)" },
      { pattern: /rm\s+-r\s+-f\s+\//, name: "rm -r -f / (recursive delete)" },
      { pattern: /rm\s+-f\s+-r\s+\//, name: "rm -f -r / (recursive delete)" },
      { pattern: /rm\s+-rf\s+\*/, name: "rm -rf * (recursive delete all)" },
      { pattern: /rm\s+-fr\s+\*/, name: "rm -fr * (recursive delete all)" },
      { pattern: /mkfs/, name: "mkfs (format disk)" },
      { pattern: /dd\s+if=/, name: "dd (disk write)" },
      { pattern: /::\s*;:/, name: "fork bomb" },
      { pattern: />\s*\/dev\/sd/, name: "write to block device" },
      { pattern: />\s*\/dev\/nvme/, name: "write to block device" },
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
  }

  private static parseConfig(fileContent: Buffer): HookConfigFile {
    if (!Buffer.isBuffer(fileContent) || fileContent.length === 0) {
      throw new Error("Uploaded hook definition is empty");
    }
    if (fileContent.length > MAX_HOOK_FILE_SIZE_BYTES) {
      throw new Error(
        `Hook definition exceeds ${MAX_HOOK_FILE_SIZE_BYTES} bytes limit`
      );
    }

    const fileText = fileContent.toString("utf-8").trim();
    if (!fileText) {
      throw new Error("Uploaded hook definition is empty");
    }

    let parsedConfig: unknown;
    try {
      parsedConfig = JSON.parse(fileText);
    } catch {
      throw new Error("Hook definition must be valid JSON");
    }

    let rawActions: unknown[] = [];
    if (Array.isArray(parsedConfig)) {
      rawActions = parsedConfig;
    } else if (parsedConfig && typeof parsedConfig === "object") {
      const asObject = parsedConfig as Record<string, unknown>;
      if (Array.isArray(asObject.actions)) {
        rawActions = asObject.actions;
      } else {
        rawActions = [asObject];
      }
    }

    if (rawActions.length === 0) {
      throw new Error("Hook definition must contain at least one action");
    }
    if (rawActions.length > 5) {
      throw new Error("Hook definition supports up to 5 actions");
    }

    const actions = rawActions.map((rawAction) =>
      parseNotifyWebhookAction(rawAction)
    );
    return { version: 1, actions };
  }

  private static loadDeclarativeConfigForEvent(
    eventName: HookEventName
  ): HookConfigFile | null {
    const configPath = this.getSafeHookPath(eventName, DECLARATIVE_HOOK_EXTENSION);
    if (this.hookFileExists(configPath)) {
      const content = this.readHookFile(configPath);
      return this.parseConfig(content);
    }

    return null;
  }

  private static getLegacyScriptPathForEvent(
    eventName: HookEventName
  ): string | null {
    const legacyScriptPath = this.getSafeHookPath(
      eventName,
      LEGACY_SCRIPT_EXTENSION
    );
    return this.hookFileExists(legacyScriptPath) ? legacyScriptPath : null;
  }

  private static buildShellHookEnv(context: HookContextMap): Record<string, string> {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string | undefined>),
    } as Record<string, string>;

    if (context.taskId) env.MYTUBE_TASK_ID = context.taskId;
    if (context.taskTitle) env.MYTUBE_TASK_TITLE = context.taskTitle;
    if (context.sourceUrl) env.MYTUBE_SOURCE_URL = context.sourceUrl;
    if (context.status) env.MYTUBE_TASK_STATUS = context.status;
    if (context.videoPath) env.MYTUBE_VIDEO_PATH = context.videoPath;
    if (context.thumbnailPath) env.MYTUBE_THUMBNAIL_PATH = context.thumbnailPath;
    if (context.error) env.MYTUBE_ERROR = context.error;

    return env;
  }

  private static async executeLegacyShellHook(
    eventName: HookEventName,
    context: HookContextMap,
    hookPath: string
  ): Promise<void> {
    logger.info(`[HookService] Executing legacy shell hook: ${eventName} (${hookPath})`);

    const env = this.buildShellHookEnv(context);
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        execFile(
          "bash",
          [hookPath],
          {
            cwd: path.dirname(hookPath),
            env,
            timeout: SHELL_HOOK_TIMEOUT_MS,
            maxBuffer: SHELL_HOOK_MAX_OUTPUT_BYTES,
          },
          (error, commandStdout, commandStderr) => {
            if (error) {
              reject(error);
              return;
            }
            resolve({
              stdout: commandStdout?.toString() ?? "",
              stderr: commandStderr?.toString() ?? "",
            });
          }
        );
      }
    );

    if (stdout.trim()) {
      logger.info(`[HookService] ${eventName} stdout: ${stdout.trim()}`);
    }
    if (stderr.trim()) {
      logger.warn(`[HookService] ${eventName} stderr: ${stderr.trim()}`);
    }

    logger.info(`[HookService] Legacy shell hook ${eventName} executed successfully`);
  }

  private static async executeAction(
    eventName: HookEventName,
    action: HookAction,
    context: HookContextMap
  ): Promise<void> {
    switch (action.type) {
      case "notify_webhook":
        await executeNotifyWebhookAction(
          {
            ...context,
            eventName,
          },
          action
        );
        return;
      default:
        throw new Error("Unsupported hook action type");
    }
  }

  private static enqueueHookExecution(
    eventName: HookEventName,
    context: HookContextMap,
    config: HookConfigFile
  ): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({
        eventName,
        context,
        config,
        resolve,
      });
      this.processQueue();
    });
  }

  private static async processQueue(): Promise<void> {
    if (this.queueProcessing) {
      return;
    }
    this.queueProcessing = true;

    try {
      while (this.queue.length > 0) {
        const current = this.queue.shift();
        if (!current) {
          continue;
        }

        const { eventName, context, config, resolve } = current;
        try {
          logger.info(
            `[HookService] Processing declarative hook for ${eventName} with ${config.actions.length} action(s)`
          );
          for (const action of config.actions) {
            await this.executeAction(eventName, action, context);
          }
          logger.info(
            `[HookService] Declarative hook ${eventName} executed successfully`
          );
        } catch (error) {
          logger.error(
            `[HookService] Declarative hook ${eventName} failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        } finally {
          resolve();
        }
      }
    } finally {
      this.queueProcessing = false;
    }
  }

  /**
   * Execute declarative hook actions if configured.
   * Events are enqueued and processed sequentially.
   */
  static async executeHook(
    eventName: string,
    context: HookContextMap
  ): Promise<void> {
    if (isStrictFeatureDisabled("hooks")) {
      logger.warn(
        `[HookService] Skipping hook execution for ${eventName}: feature disabled in strict security model`
      );
      return;
    }

    try {
      const safeEventName = this.sanitizeHookName(eventName);
      const config = this.loadDeclarativeConfigForEvent(safeEventName);
      if (!config) {
        const legacyScriptPath = this.getLegacyScriptPathForEvent(safeEventName);
        if (!legacyScriptPath) {
          return;
        }

        if (isStrictSecurityModel()) {
          recordSecurityAuditEvent({
            eventType: "config.legacy_hook_ignored",
            result: "rejected",
            target: safeEventName,
            summary: "legacy shell hook ignored because shell execution is disabled in strict security model",
            metadata: {
              eventName: safeEventName,
              hookPath: legacyScriptPath,
            },
            level: "warn",
          });
          logger.warn(
            `[HookService] Legacy shell hook detected for ${safeEventName} but shell execution is disabled in strict security model.`
          );
          return;
        }

        await this.executeLegacyShellHook(safeEventName, context, legacyScriptPath);
        return;
      }
      if (isWorkerExecutionModeEnabled()) {
        const queueService = (await import("./hookWorkerQueueService")) as {
          enqueueHookWorkerJob: (payload: {
            eventName: string;
            context: HookContextMap;
            config: HookConfigFile;
          }) => string;
        };
        const jobId = queueService.enqueueHookWorkerJob({
          eventName: safeEventName,
          context,
          config,
        });
        logger.info(
          `[HookService] Enqueued declarative hook ${safeEventName} to worker queue (${jobId})`
        );
        return;
      }
      await this.enqueueHookExecution(safeEventName, context, config);
    } catch (error) {
      logger.error(
        `[HookService] Error executing hook ${eventName}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // Do not throw to avoid interrupting download flow.
    }
  }

  static disableAllHooks(): number {
    let deletedCount = 0;
    for (const hookName of VALID_HOOK_EVENTS) {
      try {
        const hookConfigPath = this.getSafeHookPath(
          hookName,
          DECLARATIVE_HOOK_EXTENSION
        );
        if (this.removeHookFileIfExists(hookConfigPath)) {
          deletedCount += 1;
        }

        const legacyScriptPath = this.getSafeHookPath(
          hookName,
          LEGACY_SCRIPT_EXTENSION
        );
        if (this.removeHookFileIfExists(legacyScriptPath)) {
          deletedCount += 1;
        }
      } catch (error) {
        logger.warn(
          `[HookService] Failed to disable hook ${hookName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return deletedCount;
  }
  /**
   * Upload hook definition (.json) or legacy shell script (.sh/.bash)
   */
  static uploadHook(
    hookName: string,
    fileContent: Buffer,
    originalFilename?: string
  ): void {
    this.initialize();
    const safeHookName = this.sanitizeHookName(hookName);
    const uploadFormat = this.getUploadFormat(originalFilename);
    const jsonPath = this.getSafeHookPath(
      safeHookName,
      DECLARATIVE_HOOK_EXTENSION
    );
    const shellPath = this.getSafeHookPath(
      safeHookName,
      LEGACY_SCRIPT_EXTENSION
    );

    if (uploadFormat === "json") {
      const parsedConfig = this.parseConfig(fileContent);

      this.writeHookFile(
        jsonPath,
        Buffer.from(JSON.stringify(parsedConfig, null, 2), "utf-8")
      );
      this.removeHookFileIfExists(shellPath);
      logger.info(`[HookService] Uploaded declarative hook: ${jsonPath}`);
      return;
    }

    if (isStrictSecurityModel()) {
      throw new Error("Shell hook upload is disabled in strict security model");
    }
    if (!Buffer.isBuffer(fileContent) || fileContent.length === 0) {
      throw new Error("Uploaded hook definition is empty");
    }

    const fileText = fileContent.toString("utf-8");
    const riskCommand = this.detectRiskCommand(fileText);
    if (riskCommand) {
      throw new Error(`Risk command detected: ${riskCommand}. Upload rejected.`);
    }

    this.writeHookFile(shellPath, fileContent);
    this.removeHookFileIfExists(jsonPath);
    logger.info(`[HookService] Uploaded legacy shell hook: ${shellPath}`);
  }

  /**
   * Delete declarative hook definition and legacy script if exists
   */
  static deleteHook(hookName: string): boolean {
    const safeHookName = this.sanitizeHookName(hookName);
    const hookConfigPath = this.getSafeHookPath(
      safeHookName,
      DECLARATIVE_HOOK_EXTENSION
    );
    const legacyScriptPath = this.getSafeHookPath(
      safeHookName,
      LEGACY_SCRIPT_EXTENSION
    );
    let deleted = false;

    if (this.removeHookFileIfExists(hookConfigPath)) {
      deleted = true;
      logger.info(`[HookService] Deleted hook definition: ${hookConfigPath}`);
    }

    if (this.removeHookFileIfExists(legacyScriptPath)) {
      deleted = true;
      logger.info(`[HookService] Deleted legacy hook script: ${legacyScriptPath}`);
    }

    return deleted;
  }

  /**
   * Get hook status
   */
  static getHookStatus(): Record<string, boolean> {
    this.initialize();
    return VALID_HOOK_EVENTS.reduce((acc, hook) => {
      const hookConfigPath = this.getSafeHookPath(
        hook,
        DECLARATIVE_HOOK_EXTENSION
      );
      const legacyScriptPath = this.getSafeHookPath(
        hook,
        LEGACY_SCRIPT_EXTENSION
      );
      acc[hook] =
        this.hookFileExists(hookConfigPath) || this.hookFileExists(legacyScriptPath);
      return acc;
    }, {} as Record<string, boolean>);
  }
}
