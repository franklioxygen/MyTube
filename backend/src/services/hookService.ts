import { isAdminTrustLevelAtLeast } from "../config/adminTrust";
import { HOOKS_DIR } from "../config/paths";
import { logger } from "../utils/logger";
import {
  ensureDirSafeSync,
  execFileSafe,
  pathExistsSafeSync,
  resolveSafeChildPath,
  unlinkSafeSync,
  writeFileSafeSync,
} from "../utils/security";

export interface HookContext {
  taskId: string;
  taskTitle: string;
  sourceUrl?: string;
  status: "start" | "success" | "fail" | "cancel";
  videoPath?: string;
  thumbnailPath?: string;
  error?: string;
}

const sanitizeHookEnvValue = (value: string): string =>
  value.replace(/\0/g, "").replace(/[\r\n]+/g, " ").trim();

const getHookTimeoutMs = (): number | undefined => {
  const rawTimeout = process.env.MYTUBE_HOOK_TIMEOUT_MS?.trim();
  if (!rawTimeout) {
    return undefined;
  }

  const parsedTimeout = Number.parseInt(rawTimeout, 10);
  if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
    logger.warn(
      `[HookService] Ignoring invalid MYTUBE_HOOK_TIMEOUT_MS="${rawTimeout}".`
    );
    return undefined;
  }

  return parsedTimeout;
};

export class HookService {
  /**
   * Initialize hooks directory
   */
  static initialize(): void {
    ensureDirSafeSync(HOOKS_DIR, HOOKS_DIR);
  }

  private static sanitizeHookName(hookName: string): string {
    const safeName = hookName.trim();
    if (!safeName || !/^[a-zA-Z0-9_-]+$/.test(safeName)) {
      throw new Error("Invalid hook name");
    }
    return safeName;
  }

  private static getSafeHookPath(hookName: string): string {
    const safeName = this.sanitizeHookName(hookName);
    return resolveSafeChildPath(HOOKS_DIR, `${safeName}.sh`);
  }

  /**
   * Execute a hook script if it exists
   */
  static async executeHook(
    eventName: string,
    context: Record<string, string | undefined>
  ): Promise<void> {
    if (!isAdminTrustLevelAtLeast("container")) {
      logger.info(
        `[HookService] Skipping hook ${eventName}: disabled by deployment security policy.`
      );
      return;
    }

    try {
      const safeEventName = this.sanitizeHookName(eventName);
      const hookPath = this.getSafeHookPath(safeEventName);

      if (!pathExistsSafeSync(hookPath, HOOKS_DIR)) {
        return;
      }

      logger.info(
        `[HookService] Executing hook: ${safeEventName} (${hookPath})`
      );

      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      
      if (context.taskId) env.MYTUBE_TASK_ID = sanitizeHookEnvValue(context.taskId);
      if (context.taskTitle) {
        env.MYTUBE_TASK_TITLE = sanitizeHookEnvValue(context.taskTitle);
      }
      if (context.sourceUrl) {
        env.MYTUBE_SOURCE_URL = sanitizeHookEnvValue(context.sourceUrl);
      }
      if (context.status) {
        env.MYTUBE_TASK_STATUS = sanitizeHookEnvValue(context.status);
      }
      if (context.videoPath) {
        env.MYTUBE_VIDEO_PATH = sanitizeHookEnvValue(context.videoPath);
      }
      if (context.thumbnailPath) {
        env.MYTUBE_THUMBNAIL_PATH = sanitizeHookEnvValue(context.thumbnailPath);
      }
      if (context.error) {
        env.MYTUBE_ERROR = sanitizeHookEnvValue(context.error);
      }

      const timeout = getHookTimeoutMs();
      const { stdout, stderr } = await execFileSafe(
        "bash",
        [hookPath],
        timeout ? { env, timeout } : { env },
      );
      
      if (stdout && stdout.trim()) {
        logger.info(`[HookService] ${safeEventName} stdout: ${stdout.trim()}`);
      }
      if (stderr && stderr.trim()) {
        logger.warn(`[HookService] ${safeEventName} stderr: ${stderr.trim()}`);
      }

      logger.info(`[HookService] Hook ${safeEventName} executed successfully.`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        `[HookService] Error executing hook ${eventName}: ${errorMessage}`
      );
      // We log but don't re-throw to prevent hook failures from stopping the task
    }
  }
  /**
   * Upload a hook script
   */
  static uploadHook(hookName: string, fileContent: Buffer): void {
    this.initialize();
    const destPath = this.getSafeHookPath(hookName);
    if (!Buffer.isBuffer(fileContent) || fileContent.length === 0) {
      throw new Error("Invalid upload content");
    }

    writeFileSafeSync(destPath, HOOKS_DIR, fileContent);
    logger.info(`[HookService] Uploaded hook script: ${destPath}`);
  }

  /**
   * Delete a hook script
   */
  static deleteHook(hookName: string): boolean {
    const hookPath = this.getSafeHookPath(hookName);
    if (pathExistsSafeSync(hookPath, HOOKS_DIR)) {
      unlinkSafeSync(hookPath, HOOKS_DIR);
      logger.info(`[HookService] Deleted hook script: ${hookPath}`);
      return true;
    }
    return false;
  }

  /**
   * Get hook status
   */
  static getHookStatus(): Record<string, boolean> {
    this.initialize();
    return {
      task_before_start: pathExistsSafeSync(
        this.getSafeHookPath("task_before_start"),
        HOOKS_DIR,
      ),
      task_success: pathExistsSafeSync(
        this.getSafeHookPath("task_success"),
        HOOKS_DIR,
      ),
      task_fail: pathExistsSafeSync(
        this.getSafeHookPath("task_fail"),
        HOOKS_DIR,
      ),
      task_cancel: pathExistsSafeSync(
        this.getSafeHookPath("task_cancel"),
        HOOKS_DIR,
      ),
    };
  }
}
