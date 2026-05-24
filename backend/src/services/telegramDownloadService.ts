import { Request, Response } from "express";
import { downloadVideo } from "../controllers/videoDownloadController";
import { Settings } from "../types/settings";
import { buildAllowlistedHttpUrl } from "../utils/security";
import { logger } from "../utils/logger";
import * as storageService from "./storageService";
import { getTelegramStrings, TelegramService } from "./telegramService";

const TELEGRAM_ALLOWED_HOSTS = ["api.telegram.org"];
const TELEGRAM_POLL_INTERVAL_MS = 5000;
const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
];

type TelegramChat = {
  id?: number | string;
};

type TelegramMessage = {
  chat?: TelegramChat;
  text?: string;
  caption?: string;
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

type TelegramGetUpdatesResponse = {
  ok?: boolean;
  result?: TelegramUpdate[];
  description?: string;
};

export type TelegramQueueResult = {
  status: "queued" | "skipped" | "failed";
  downloadId?: string;
  error?: string;
};

export type HandleTelegramUpdateResult = {
  handled: boolean;
  urls: string[];
  replies: string[];
};

type QueueDownload = (url: string) => Promise<TelegramQueueResult>;

let pollTimer: NodeJS.Timeout | null = null;
let pollInFlight = false;
let lastUpdateId: number | null = null;
let lastPollingIdentity: string | null = null;

function getTelegramMessage(update: TelegramUpdate): TelegramMessage | null {
  return (
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.edited_channel_post ??
    null
  );
}

function normalizeChatId(value: unknown): string {
  return String(value ?? "").trim();
}

function getMessageText(message: TelegramMessage): string {
  return message.text ?? message.caption ?? "";
}

function trimExtractedUrl(url: string): string {
  return url.replace(/[)\].,!?，。！？、；;:]+$/u, "");
}

export function extractUrlsFromTelegramText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'`，。！？、；]+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of matches) {
    const url = trimExtractedUrl(match);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

function getPollingSettings(): Settings {
  return storageService.getSettings() as Settings;
}

function isPollingEnabled(settings: Settings): boolean {
  return (
    settings.telegramEnabled === true &&
    settings.telegramDownloadEnabled === true &&
    typeof settings.telegramBotToken === "string" &&
    settings.telegramBotToken.trim().length > 0 &&
    typeof settings.telegramChatId === "string" &&
    settings.telegramChatId.trim().length > 0
  );
}

function getPollingIdentity(settings: Settings): string {
  return `${settings.telegramBotToken ?? ""}:${settings.telegramChatId ?? ""}`;
}

function buildTelegramGetUpdatesUrl(
  botToken: string,
  offset: number | null
): string {
  const url = new URL(
    buildAllowlistedHttpUrl(
      `https://api.telegram.org/bot${botToken}/getUpdates`,
      TELEGRAM_ALLOWED_HOSTS
    )
  );

  if (offset !== null) {
    url.searchParams.set("offset", String(offset));
  }
  url.searchParams.set("timeout", "0");
  url.searchParams.set("allowed_updates", JSON.stringify(TELEGRAM_ALLOWED_UPDATES));
  return url.toString();
}

function updateLastUpdateId(updates: TelegramUpdate[]): void {
  for (const update of updates) {
    if (typeof update.update_id === "number") {
      lastUpdateId = Math.max(lastUpdateId ?? update.update_id, update.update_id);
    }
  }
}

function summarizeQueueResult(
  url: string,
  result: TelegramQueueResult,
  language?: string
): string {
  const s = getTelegramStrings(language);
  if (result.status === "queued") {
    return result.downloadId
      ? `${s.queued}: ${url}\n${s.taskId}: ${result.downloadId}`
      : `${s.queued}: ${url}`;
  }

  if (result.status === "skipped") {
    return `${s.skipped}: ${url}`;
  }

  return `${s.failed}: ${url}\n${result.error ?? s.unknownError}`;
}

async function sendReplies(replies: string[]): Promise<void> {
  if (replies.length === 0) return;
  await TelegramService.sendConfiguredPlainMessage(replies.join("\n\n"));
}

export async function queueDownloadFromTelegram(
  url: string
): Promise<TelegramQueueResult> {
  let statusCode = 200;
  let payload: any;
  let responded = false;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      responded = true;
      return this;
    },
    send(body: unknown) {
      payload = body;
      responded = true;
      return this;
    },
  } as unknown as Response;

  const req = {
    body: {
      youtubeUrl: url,
      statisticsContext: {
        sourceKind: "api",
      },
    },
    headers: {
      "x-mytube-client": "telegram",
    },
    apiKeyAuthenticated: true,
    user: {
      role: "admin",
    },
  } as unknown as Request;

  await downloadVideo(req, res);

  if (!responded) {
    return {
      status: "failed",
      error: getTelegramStrings(getPollingSettings().language)
        .downloadRequestNoResponse,
    };
  }

  if (statusCode >= 400) {
    return {
      status: "failed",
      error:
        typeof payload?.error === "string"
          ? payload.error
          : `HTTP ${statusCode}`,
    };
  }

  if (payload?.success === true) {
    return {
      status: "queued",
      downloadId:
        typeof payload.downloadId === "string" ? payload.downloadId : undefined,
    };
  }

  return {
    status: "skipped",
  };
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  queueDownload: QueueDownload = queueDownloadFromTelegram
): Promise<HandleTelegramUpdateResult> {
  const settings = getPollingSettings();
  if (!isPollingEnabled(settings)) {
    return { handled: false, urls: [], replies: [] };
  }

  const message = getTelegramMessage(update);
  if (!message) {
    return { handled: false, urls: [], replies: [] };
  }

  const configuredChatId = normalizeChatId(settings.telegramChatId);
  const chatId = normalizeChatId(message.chat?.id);
  if (!chatId || chatId !== configuredChatId) {
    return { handled: false, urls: [], replies: [] };
  }

  const urls = extractUrlsFromTelegramText(getMessageText(message));
  if (urls.length === 0) {
    return { handled: false, urls: [], replies: [] };
  }

  const replies: string[] = [];
  for (const url of urls) {
    try {
      const result = await queueDownload(url);
      replies.push(summarizeQueueResult(url, result, settings.language));
    } catch (error) {
      replies.push(
        summarizeQueueResult(
          url,
          {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          },
          settings.language
        )
      );
    }
  }

  await sendReplies(replies);
  return { handled: true, urls, replies };
}

export async function pollTelegramUpdates(
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const settings = getPollingSettings();
  if (!isPollingEnabled(settings)) {
    lastUpdateId = null;
    lastPollingIdentity = null;
    return;
  }

  const identity = getPollingIdentity(settings);
  if (identity !== lastPollingIdentity) {
    lastUpdateId = null;
    lastPollingIdentity = identity;
  }

  const currentLastUpdateId = lastUpdateId;
  const isInitialSync = currentLastUpdateId === null;
  const url = buildTelegramGetUpdatesUrl(
    settings.telegramBotToken as string,
    isInitialSync ? null : currentLastUpdateId + 1
  );
  const response = await fetchImpl(url); // nosemgrep
  const body = (await response.json()) as TelegramGetUpdatesResponse;

  if (!response.ok || body.ok !== true || !Array.isArray(body.result)) {
    throw new Error(body.description || `Telegram getUpdates failed: ${response.status}`);
  }

  const updates = body.result;
  updateLastUpdateId(updates);

  // The first enabled poll is only a synchronization point so old bot messages
  // do not unexpectedly enqueue downloads after toggling the feature on.
  if (isInitialSync) {
    if (lastUpdateId === null) {
      lastUpdateId = 0;
    }
    return;
  }

  for (const update of updates) {
    await handleTelegramUpdate(update);
  }
}

export function startTelegramDownloadPolling(): void {
  if (pollTimer !== null) return;

  const runPoll = async (): Promise<void> => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      await pollTelegramUpdates();
    } catch (error) {
      logger.warn(
        "[TelegramDownloadService] Poll failed:",
        error instanceof Error ? error : new Error(String(error))
      );
    } finally {
      pollInFlight = false;
    }
  };

  void runPoll();
  pollTimer = setInterval(() => {
    void runPoll();
  }, TELEGRAM_POLL_INTERVAL_MS);
  pollTimer.unref?.();
}

export function stopTelegramDownloadPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  pollInFlight = false;
  lastUpdateId = null;
  lastPollingIdentity = null;
}
