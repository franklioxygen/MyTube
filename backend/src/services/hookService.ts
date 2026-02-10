import child_process from "child_process";
import fs from "fs";
import path from "path";
import util from "util";
import { HOOKS_DIR } from "../config/paths";
import { logger } from "../utils/logger";
import { isPathWithinDirectory } from "../utils/security";

export interface HookContext {
  taskId: string;
  taskTitle: string;
  sourceUrl?: string;
  status: "start" | "success" | "fail" | "cancel";
  videoPath?: string;
  thumbnailPath?: string;
  error?: string;
}

const execPromise = util.promisify(child_process.exec);

export class HookService {
  /**
   * Initialize hooks directory
   */
  static initialize(): void {
    if (!fs.existsSync(HOOKS_DIR)) {
      fs.mkdirSync(HOOKS_DIR, { recursive: true });
    }
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
    const resolvedHooksDir = path.resolve(HOOKS_DIR);
    const hookPath = path.resolve(resolvedHooksDir, `${safeName}.sh`);
    if (!isPathWithinDirectory(hookPath, resolvedHooksDir)) {
      throw new Error("Invalid hook path");
    }
    return hookPath;
  }

  /**
   * Execute a hook script if it exists
   */
  static async executeHook(
    eventName: string,
    context: Record<string, string | undefined>
  ): Promise<void> {
    try {
      const safeEventName = this.sanitizeHookName(eventName);
      const hookPath = this.getSafeHookPath(safeEventName);

      if (!fs.existsSync(hookPath)) {
        return;
      }

      logger.info(
        `[HookService] Executing hook: ${safeEventName} (${hookPath})`
      );

      // Ensure the script is executable
      fs.chmodSync(hookPath, "755");

      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      
      if (context.taskId) env.MYTUBE_TASK_ID = context.taskId;
      if (context.taskTitle) env.MYTUBE_TASK_TITLE = context.taskTitle;
      if (context.sourceUrl) env.MYTUBE_SOURCE_URL = context.sourceUrl;
      if (context.status) env.MYTUBE_TASK_STATUS = context.status;
      if (context.videoPath) env.MYTUBE_VIDEO_PATH = context.videoPath;
      if (context.thumbnailPath) env.MYTUBE_THUMBNAIL_PATH = context.thumbnailPath;
      if (context.error) env.MYTUBE_ERROR = context.error;

      const { stdout, stderr } = await execPromise(`bash "${hookPath}"`, { env });
      
      if (stdout && stdout.trim()) {
        logger.info(`[HookService] ${safeEventName} stdout: ${stdout.trim()}`);
      }
      if (stderr && stderr.trim()) {
        logger.warn(`[HookService] ${safeEventName} stderr: ${stderr.trim()}`);
      }

      logger.info(`[HookService] Hook ${safeEventName} executed successfully.`);
    } catch (error: any) {
      logger.error(
        `[HookService] Error executing hook ${eventName}: ${error.message}`
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
    
    fs.writeFileSync(destPath, fileContent);
    
    // Make executable
    fs.chmodSync(destPath, "755");
    logger.info(`[HookService] Uploaded hook script: ${destPath}`);
  }

  /**
   * Delete a hook script
   */
  static deleteHook(hookName: string): boolean {
    const hookPath = this.getSafeHookPath(hookName);
    if (fs.existsSync(hookPath)) {
      fs.unlinkSync(hookPath);
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
    const hooks = [
      "task_before_start",
      "task_success",
      "task_fail",
      "task_cancel",
    ];
    
    return hooks.reduce((acc, hook) => {
      acc[hook] = fs.existsSync(this.getSafeHookPath(hook));
      return acc;
    }, {} as Record<string, boolean>);
  }
}
