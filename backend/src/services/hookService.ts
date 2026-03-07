import fs from "fs";
import path from "path";
import { HOOKS_DIR } from "../config/paths";
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

const DECLARATIVE_HOOK_EXTENSION = ".json";
const LEGACY_SCRIPT_EXTENSION = ".sh";
const MAX_HOOK_FILE_SIZE_BYTES = 32 * 1024;
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

  private static getSafeHookPath(
    hookName: HookEventName,
    extension: string
  ): string {
    const resolvedHooksDir = path.resolve(HOOKS_DIR);
    const hookPath = path.resolve(resolvedHooksDir, `${hookName}${extension}`);
    if (!isPathWithinDirectory(hookPath, resolvedHooksDir)) {
      throw new Error("Invalid hook path");
    }
    return hookPath;
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

  private static loadConfigForEvent(
    eventName: HookEventName
  ): HookConfigFile | null {
    const configPath = this.getSafeHookPath(eventName, DECLARATIVE_HOOK_EXTENSION);
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(configPath)) {
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      const content = fs.readFileSync(configPath);
      return this.parseConfig(content);
    }

    const legacyScriptPath = this.getSafeHookPath(
      eventName,
      LEGACY_SCRIPT_EXTENSION
    );
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(legacyScriptPath)) {
      recordSecurityAuditEvent({
        eventType: "config.legacy_hook_ignored",
        result: "rejected",
        target: eventName,
        summary: "legacy shell hook ignored because shell execution is disabled",
        metadata: {
          eventName,
          hookPath: legacyScriptPath,
        },
        level: "warn",
      });
      logger.warn(
        `[HookService] Legacy shell hook detected for ${eventName} but shell execution is disabled. Upload declarative JSON hook definition instead.`
      );
    }
    return null;
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
      const config = this.loadConfigForEvent(safeEventName);
      if (!config) {
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
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        if (fs.existsSync(hookConfigPath)) {
          // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
          fs.unlinkSync(hookConfigPath);
          deletedCount += 1;
        }

        const legacyScriptPath = this.getSafeHookPath(
          hookName,
          LEGACY_SCRIPT_EXTENSION
        );
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        if (fs.existsSync(legacyScriptPath)) {
          // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
          fs.unlinkSync(legacyScriptPath);
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
   * Upload declarative hook definition (JSON)
   */
  static uploadHook(hookName: string, fileContent: Buffer): void {
    this.initialize();
    const safeHookName = this.sanitizeHookName(hookName);
    const parsedConfig = this.parseConfig(fileContent);
    const destinationPath = this.getSafeHookPath(
      safeHookName,
      DECLARATIVE_HOOK_EXTENSION
    );

    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    fs.writeFileSync(
      destinationPath,
      Buffer.from(JSON.stringify(parsedConfig, null, 2), "utf-8")
    );
    logger.info(`[HookService] Uploaded declarative hook: ${destinationPath}`);
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

    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(hookConfigPath)) {
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      fs.unlinkSync(hookConfigPath);
      deleted = true;
      logger.info(`[HookService] Deleted hook definition: ${hookConfigPath}`);
    }

    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(legacyScriptPath)) {
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      fs.unlinkSync(legacyScriptPath);
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
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      acc[hook] = fs.existsSync(hookConfigPath);
      return acc;
    }, {} as Record<string, boolean>);
  }
}
