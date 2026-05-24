import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../storageService", () => ({
  getSettings: vi.fn(),
}));

vi.mock("../telegramService", () => ({
  getTelegramStrings: (language?: string) => {
    if (language === "zh") {
      return {
        queued: "已加入队列",
        skipped: "已跳过",
        failed: "失败",
        taskId: "任务 ID",
        unknownError: "未知错误",
        downloadRequestNoResponse: "下载请求没有返回响应",
      };
    }
    return {
      queued: "Queued",
      skipped: "Skipped",
      failed: "Failed",
      taskId: "Task ID",
      unknownError: "Unknown error",
      downloadRequestNoResponse: "Download request did not return a response",
    };
  },
  TelegramService: {
    sendConfiguredPlainMessage: vi.fn(),
  },
}));

vi.mock("../../controllers/videoDownloadController", () => ({
  downloadVideo: vi.fn(),
}));

import { downloadVideo } from "../../controllers/videoDownloadController";
import * as storageService from "../storageService";
import { TelegramService } from "../telegramService";
import {
  extractUrlsFromTelegramText,
  handleTelegramUpdate,
  pollTelegramUpdates,
  queueDownloadFromTelegram,
  stopTelegramDownloadPolling,
} from "../telegramDownloadService";

const enabledSettings = {
  telegramEnabled: true,
  telegramDownloadEnabled: true,
  telegramBotToken: "123456789:ABC-def",
  telegramChatId: "123456",
  language: "en",
};

function mockTelegramResponse(updates: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      result: updates,
    }),
  };
}

describe("telegramDownloadService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopTelegramDownloadPolling();
    vi.mocked(storageService.getSettings).mockReturnValue(enabledSettings);
    vi.mocked(downloadVideo).mockImplementation(
      async (_req: ExpressRequest, res: ExpressResponse) => {
        res.status(200).json({ success: true, downloadId: "task-1" });
      }
    );
  });

  it("extracts unique URLs without trigger keywords", () => {
    expect(
      extractUrlsFromTelegramText(
        "看这个 https://youtu.be/abc123。还有 https://example.com/video?id=1, https://youtu.be/abc123"
      )
    ).toEqual(["https://youtu.be/abc123", "https://example.com/video?id=1"]);
  });

  it("ignores messages when telegram download is disabled", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      ...enabledSettings,
      telegramDownloadEnabled: false,
    });

    const result = await handleTelegramUpdate({
      update_id: 1,
      message: {
        chat: { id: "123456" },
        text: "https://youtu.be/abc123",
      },
    });

    expect(result.handled).toBe(false);
    expect(downloadVideo).not.toHaveBeenCalled();
    expect(TelegramService.sendConfiguredPlainMessage).not.toHaveBeenCalled();
  });

  it("ignores unauthorized chat IDs", async () => {
    const result = await handleTelegramUpdate({
      update_id: 1,
      message: {
        chat: { id: "999" },
        text: "https://youtu.be/abc123",
      },
    });

    expect(result.handled).toBe(false);
    expect(downloadVideo).not.toHaveBeenCalled();
    expect(TelegramService.sendConfiguredPlainMessage).not.toHaveBeenCalled();
  });

  it("queues links from authorized Telegram messages and replies", async () => {
    const result = await handleTelegramUpdate({
      update_id: 1,
      message: {
        chat: { id: 123456 },
        text: "https://youtu.be/abc123",
      },
    });

    expect(result.handled).toBe(true);
    expect(result.urls).toEqual(["https://youtu.be/abc123"]);
    expect(downloadVideo).toHaveBeenCalledOnce();
    expect(TelegramService.sendConfiguredPlainMessage).toHaveBeenCalledWith(
      expect.stringContaining("Task ID: task-1")
    );
  });

  it("uses the configured language for Telegram queue replies", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      ...enabledSettings,
      language: "zh",
    });

    const result = await handleTelegramUpdate({
      update_id: 1,
      message: {
        chat: { id: 123456 },
        text: "https://youtu.be/abc123",
      },
    });

    expect(result.replies[0]).toContain("已加入队列");
    expect(result.replies[0]).toContain("任务 ID: task-1");
    expect(TelegramService.sendConfiguredPlainMessage).toHaveBeenCalledWith(
      expect.stringContaining("已加入队列")
    );
  });

  it("adapts Telegram downloads into the existing download controller", async () => {
    await queueDownloadFromTelegram("https://youtu.be/abc123");

    const [req] = vi.mocked(downloadVideo).mock.calls[0];
    const typedReq = req as ExpressRequest & {
      apiKeyAuthenticated?: boolean;
      user?: { role?: string };
    };
    expect(typedReq.body.youtubeUrl).toBe("https://youtu.be/abc123");
    expect(typedReq.body.statisticsContext.sourceKind).toBe("api");
    expect(typedReq.headers["x-mytube-client"]).toBe("telegram");
    expect(typedReq.apiKeyAuthenticated).toBe(true);
    expect(typedReq.user?.role).toBe("admin");
  });

  it("uses the first poll as synchronization and processes later updates", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockTelegramResponse([
          {
            update_id: 10,
            message: {
              chat: { id: "123456" },
              text: "https://youtu.be/old",
            },
          },
        ])
      )
      .mockResolvedValueOnce(
        mockTelegramResponse([
          {
            update_id: 11,
            message: {
              chat: { id: "123456" },
              text: "https://youtu.be/new",
            },
          },
        ])
      );

    await pollTelegramUpdates(fetchImpl as unknown as typeof fetch);
    expect(downloadVideo).not.toHaveBeenCalled();

    await pollTelegramUpdates(fetchImpl as unknown as typeof fetch);
    expect(downloadVideo).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[1][0]).toContain("offset=11");
  });
});
