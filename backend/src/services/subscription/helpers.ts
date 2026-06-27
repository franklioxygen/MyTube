import { logger } from "../../utils/logger";
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

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const maybeError = error as { message?: unknown };
    if (typeof maybeError.message === "string") {
      return maybeError.message;
    }
  }

  return fallback;
}

export function buildFilenameTemplateSourceOptions(
  sub: Subscription,
  mediaPlaylistIndex?: number
): FilenameTemplateSourceOptions {
  const isPlaylist =
    sub.subscriptionType === "playlist" || Boolean(sub.playlistId);

  return {
    sourceCustomName: sub.author,
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
