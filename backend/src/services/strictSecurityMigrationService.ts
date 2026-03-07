import { isStrictSecurityModel } from "../config/securityModel";
import { Settings, defaultSettings } from "../types/settings";
import { logger } from "../utils/logger";
import { HookService } from "./hookService";
import * as storageService from "./storageService";

const STRICT_SECURITY_MIGRATION_VERSION = 1;

export const runStrictSecurityMigrationIfNeeded = (): void => {
  if (!isStrictSecurityModel()) {
    return;
  }

  const rawSettings = storageService.getSettings();
  const mergedSettings: Settings = {
    ...defaultSettings,
    ...rawSettings,
  };

  const currentVersion =
    typeof mergedSettings.strictSecurityMigrationVersion === "number"
      ? mergedSettings.strictSecurityMigrationVersion
      : 0;

  if (currentVersion >= STRICT_SECURITY_MIGRATION_VERSION) {
    return;
  }

  const migrationNotes: string[] = [];
  const settingsPatch: Partial<Settings> = {
    strictSecurityMigrationVersion: STRICT_SECURITY_MIGRATION_VERSION,
  };

  const disabledHooksCount = HookService.disableAllHooks();
  if (disabledHooksCount > 0) {
    migrationNotes.push(`disabled ${disabledHooksCount} legacy hook script(s)`);
  }

  if (
    typeof mergedSettings.ytDlpConfig === "string" &&
    mergedSettings.ytDlpConfig.trim().length > 0
  ) {
    settingsPatch.ytDlpConfig = "";
    migrationNotes.push("cleared legacy yt-dlp text configuration");
  }

  if (mergedSettings.cloudflaredTunnelEnabled === true) {
    settingsPatch.cloudflaredTunnelEnabled = false;
    migrationNotes.push("disabled cloudflared in-app control");
  }

  if (
    typeof mergedSettings.mountDirectories === "string" &&
    mergedSettings.mountDirectories.trim().length > 0
  ) {
    const mountPathCount = mergedSettings.mountDirectories
      .split("\n")
      .map((value) => value.trim())
      .filter((value) => value.length > 0).length;
    migrationNotes.push(
      `froze mountDirectories API write (${mountPathCount} configured path(s) preserved read-only)`
    );
  }

  storageService.saveSettings(settingsPatch as Record<string, unknown>);

  if (migrationNotes.length > 0) {
    logger.warn(
      `[StrictSecurityMigration] Applied v${STRICT_SECURITY_MIGRATION_VERSION}: ${migrationNotes.join(
        "; "
      )}`
    );
    return;
  }

  logger.info(
    `[StrictSecurityMigration] Applied v${STRICT_SECURITY_MIGRATION_VERSION}: no legacy high-risk state detected`
  );
};
