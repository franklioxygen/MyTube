// Periodically evaluates anomalies derived from the statistics layer and
// reuses the existing Telegram pipeline for the two consequential P0 alerts:
// - subscription consecutive-failure streak >= 5
// - disk runway under 7 days for a writable local volume
//
// Each alert is rate-limited per anomaly key to one notification per 24h
// (design §5.2). Subscription success-rate regressions and search zero-result
// spikes remain dashboard-only and are not delivered through Telegram.

import { sqlite } from "../db";
import { logger } from "../utils/logger";
import * as storageService from "./storageService";
import { TelegramService } from "./telegramService";
import { isStatisticsEnabled, estimateDiskRunway } from "./statistics";

interface RecentAlertState {
  key: string;
  lastDispatchedAt: number;
}

const recent: Map<string, RecentAlertState> = new Map();
const ALERT_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

let alertTimer: ReturnType<typeof setInterval> | null = null;

interface SettingsLike {
  telegramEnabled?: boolean;
}

function shouldDispatchAlert(key: string): boolean {
  const entry = recent.get(key);
  if (!entry) return true;
  return Date.now() - entry.lastDispatchedAt > ALERT_DEBOUNCE_MS;
}

function markAlertDispatched(key: string): void {
  recent.set(key, { key, lastDispatchedAt: Date.now() });
}

function evaluateSubscriptionFailureStreaks(): void {
  if (!isStatisticsEnabled()) return;
  const settings = storageService.getSettings() as SettingsLike;
  if (!settings.telegramEnabled) return;
  try {
    const rows = sqlite
      .prepare(
        `SELECT id, author, consecutive_failure_count
         FROM subscriptions
         WHERE COALESCE(consecutive_failure_count, 0) >= 5`
      )
      .all() as Array<{
        id: string;
        author: string;
        consecutive_failure_count: number;
      }>;
    for (const row of rows) {
      const key = `subscription_failure_streak:${row.id}`;
      if (!shouldDispatchAlert(key)) continue;
      const text = `Subscription "${row.author}" has failed ${row.consecutive_failure_count} checks in a row.`;
      void TelegramService.sendAlert(text)
        .then((ok) => {
          if (ok) markAlertDispatched(key);
        })
        .catch(() => {});
    }
  } catch (error) {
    logger.debug(
      "subscription failure-streak alert evaluation failed",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

function evaluateDiskRunway(): void {
  if (!isStatisticsEnabled()) return;
  const settings = storageService.getSettings() as SettingsLike;
  if (!settings.telegramEnabled) return;

  const runway = estimateDiskRunway();
  if (runway.status !== "ok" || !runway.volumes || runway.volumes.length === 0) {
    return;
  }

  for (const volume of runway.volumes) {
    const days = volume.daysRemaining;
    if (days < 7) {
      const key = `disk_runway:${volume.rootPath}`;
      if (!shouldDispatchAlert(key)) continue;
      const text = `Disk runway for ${volume.rootPath} is approximately ${Math.max(
        0,
        Math.floor(days)
      )} days.`;
      void TelegramService.sendAlert(text)
        .then((ok) => {
          if (ok) markAlertDispatched(key);
        })
        .catch(() => {});
    }
  }
}

export async function evaluateAlertsNow(): Promise<void> {
  evaluateSubscriptionFailureStreaks();
  evaluateDiskRunway();
}

export function startStatisticsAlertDispatcher(): void {
  if (alertTimer !== null) return;
  // Wait one minute, then run every 30 minutes.
  setTimeout(() => {
    void evaluateAlertsNow().catch(() => {});
  }, 60_000);
  alertTimer = setInterval(() => {
    void evaluateAlertsNow().catch(() => {});
  }, 30 * 60 * 1000);
}

export function stopStatisticsAlertDispatcher(): void {
  if (alertTimer !== null) {
    clearInterval(alertTimer);
    alertTimer = null;
  }
}
