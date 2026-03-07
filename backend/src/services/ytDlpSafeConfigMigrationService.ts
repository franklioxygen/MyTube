import { defaultSettings, Settings } from "../types/settings";
import { logger } from "../utils/logger";
import {
  deriveYtDlpSafeConfigFromLegacyText,
  normalizeYtDlpSafeConfig,
} from "../utils/ytDlpSafeConfig";
import * as storageService from "./storageService";

const YT_DLP_SAFE_CONFIG_MIGRATION_VERSION = 1;

export const runYtDlpSafeConfigMigrationIfNeeded = (): void => {
  const rawSettings = storageService.getSettings();
  const mergedSettings: Settings = {
    ...defaultSettings,
    ...rawSettings,
  };

  const currentVersion =
    typeof mergedSettings.ytDlpSafeConfigMigrationVersion === "number"
      ? mergedSettings.ytDlpSafeConfigMigrationVersion
      : 0;
  if (currentVersion >= YT_DLP_SAFE_CONFIG_MIGRATION_VERSION) {
    return;
  }

  const migrationNotes: string[] = [];
  const settingsPatch: Partial<Settings> = {
    ytDlpSafeConfigMigrationVersion: YT_DLP_SAFE_CONFIG_MIGRATION_VERSION,
  };

  const existingSafeConfig = normalizeYtDlpSafeConfig(
    mergedSettings.ytDlpSafeConfig,
    {
      rejectUnknownKeys: false,
      rejectInvalidValues: false,
    }
  );
  if (
    Object.keys(existingSafeConfig.config).length > 0 ||
    mergedSettings.ytDlpSafeConfig !== undefined
  ) {
    settingsPatch.ytDlpSafeConfig = existingSafeConfig.config;
    if (existingSafeConfig.rejectedOptions.length > 0) {
      migrationNotes.push(
        `cleaned invalid ytDlpSafeConfig options: ${existingSafeConfig.rejectedOptions.join(", ")}`
      );
    }
  }

  if (
    typeof mergedSettings.ytDlpConfig === "string" &&
    mergedSettings.ytDlpConfig.trim().length > 0
  ) {
    const migratedFromLegacy = deriveYtDlpSafeConfigFromLegacyText(
      mergedSettings.ytDlpConfig
    );
    settingsPatch.ytDlpSafeConfig = migratedFromLegacy.config;
    settingsPatch.ytDlpConfig = "";

    const migratedKeys = Object.keys(migratedFromLegacy.config);
    migrationNotes.push(
      `migrated legacy ytDlpConfig text to structured allowlist (${migratedKeys.length} key(s))`
    );
    if (migratedFromLegacy.rejectedOptions.length > 0) {
      migrationNotes.push(
        `rejected legacy yt-dlp options: ${migratedFromLegacy.rejectedOptions.join(", ")}`
      );
    }
  }

  storageService.saveSettings(settingsPatch as Record<string, unknown>);

  if (migrationNotes.length > 0) {
    logger.warn(
      `[YtDlpSafeConfigMigration] Applied v${YT_DLP_SAFE_CONFIG_MIGRATION_VERSION}: ${migrationNotes.join(
        "; "
      )}`
    );
    return;
  }

  logger.info(
    `[YtDlpSafeConfigMigration] Applied v${YT_DLP_SAFE_CONFIG_MIGRATION_VERSION}: no legacy yt-dlp config migration needed`
  );
};
