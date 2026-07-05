import { getErrorMessage as getSharedErrorMessage } from "../../utils/errors";
import { logger } from "../../utils/logger";
import {
  isPlaylistSource,
  resolvePlaylistSourceCustomName,
} from "../filenameTemplate/sourceNaming";
import { FilenameTemplateSourceOptions } from "../filenameTemplate/types";
import { TelegramService } from "../telegramService";
import { Subscription } from "./types";

export function notifySubscriptionDownloadResult(context: {
  taskTitle: string;
  status: "success" | "fail";
  sourceUrl?: string;
  error?: string;
}): void {
  void TelegramService.notifyTaskComplete(context).catch((error) => {
    logger.error(
      "Subscription Telegram notification failed:",
      error instanceof Error ? error : new Error(String(error))
    );
  });
}

/**
 * Re-export of the shared {@link getErrorMessage} from utils/errors.
 * Kept here so existing subscription-module imports continue to resolve.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  return getSharedErrorMessage(error, fallback);
}

export function buildFilenameTemplateSourceOptions(
  sub: Subscription,
  mediaPlaylistIndex?: number
): FilenameTemplateSourceOptions {
  const isPlaylist = isPlaylistSource(sub);
  const sourceCustomName = isPlaylist
    ? resolvePlaylistSourceCustomName(sub)
    : sub.author;

  return {
    sourceCustomName,
    sourceCollectionName: sub.playlistTitle || sub.author,
    sourceCollectionId: sub.playlistId || sub.collectionId || "",
    sourceCollectionType: isPlaylist ? "playlist" : "channel",
    mediaPlaylistIndex,
  };
}

export function getSubscriptionLogContext(
  sub: {
    id: string;
    author?: string | null;
    authorUrl?: string | null;
    platform?: string | null;
  },
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    subscriptionId: sub.id,
    author: sub.author,
    authorUrl: sub.authorUrl,
    platform: sub.platform,
    ...extras,
  };
}
