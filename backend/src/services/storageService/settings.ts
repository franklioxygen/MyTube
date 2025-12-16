import { DatabaseError } from "../../errors/DownloadErrors";
import { db } from "../../db";
import { settings } from "../../db/schema";
import { logger } from "../../utils/logger";

export function getSettings(): Record<string, any> {
  try {
    const allSettings = db.select().from(settings).all();
    const settingsMap: Record<string, any> = {};

    for (const setting of allSettings) {
      try {
        settingsMap[setting.key] = JSON.parse(setting.value);
      } catch (e) {
        settingsMap[setting.key] = setting.value;
      }
    }

    return settingsMap;
  } catch (error) {
    logger.error("Error getting settings", error instanceof Error ? error : new Error(String(error)));
    // Return empty object for backward compatibility
    return {};
  }
}

export function saveSettings(newSettings: Record<string, any>): void {
  try {
    db.transaction(() => {
      for (const [key, value] of Object.entries(newSettings)) {
        db.insert(settings)
          .values({
            key,
            value: JSON.stringify(value),
          })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: JSON.stringify(value) },
          })
          .run();
      }
    });
  } catch (error) {
    logger.error("Error saving settings", error instanceof Error ? error : new Error(String(error)));
    throw new DatabaseError(
      "Failed to save settings",
      error instanceof Error ? error : new Error(String(error)),
      "saveSettings"
    );
  }
}
