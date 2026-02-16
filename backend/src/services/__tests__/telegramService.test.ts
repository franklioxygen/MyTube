import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../storageService", () => ({
  getSettings: vi.fn(),
}));

import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import { TelegramService } from "../telegramService";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("TelegramService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  const enabledSettings = {
    telegramEnabled: true,
    telegramBotToken: "test-token",
    telegramChatId: "123456",
    telegramNotifyOnSuccess: true,
    telegramNotifyOnFail: true,
    language: "en",
  };

  describe("notifyTaskComplete", () => {
    it("should send success notification when enabled", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(enabledSettings);

      await TelegramService.notifyTaskComplete({
        taskTitle: "Test Video",
        status: "success",
        sourceUrl: "https://example.com/video",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
      const body = JSON.parse(options.body);
      expect(body.chat_id).toBe("123456");
      expect(body.parse_mode).toBe("HTML");
      expect(body.text).toContain("Task Success");
      expect(body.text).toContain("Test Video");
      expect(body.text).toContain("https://example.com/video");
    });

    it("should send fail notification with error details", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(enabledSettings);

      await TelegramService.notifyTaskComplete({
        taskTitle: "Failed Video",
        status: "fail",
        sourceUrl: "https://example.com/fail",
        error: "Download timeout",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("Task Failed");
      expect(body.text).toContain("Failed Video");
      expect(body.text).toContain("Download timeout");
    });

    it("should not send when telegram is disabled", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ...enabledSettings,
        telegramEnabled: false,
      });

      await TelegramService.notifyTaskComplete({
        taskTitle: "Test",
        status: "success",
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should not send when bot token is missing", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ...enabledSettings,
        telegramBotToken: "",
      });

      await TelegramService.notifyTaskComplete({
        taskTitle: "Test",
        status: "success",
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should not send when chat ID is missing", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ...enabledSettings,
        telegramChatId: "",
      });

      await TelegramService.notifyTaskComplete({
        taskTitle: "Test",
        status: "success",
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should skip success notification when telegramNotifyOnSuccess is false", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ...enabledSettings,
        telegramNotifyOnSuccess: false,
      });

      await TelegramService.notifyTaskComplete({
        taskTitle: "Test",
        status: "success",
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should skip fail notification when telegramNotifyOnFail is false", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ...enabledSettings,
        telegramNotifyOnFail: false,
      });

      await TelegramService.notifyTaskComplete({
        taskTitle: "Test",
        status: "fail",
        error: "Some error",
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should send success notification when telegramNotifyOnSuccess is undefined (default)", async () => {
      const settings = { ...enabledSettings };
      delete (settings as any).telegramNotifyOnSuccess;
      vi.mocked(storageService.getSettings).mockReturnValue(settings);

      await TelegramService.notifyTaskComplete({
        taskTitle: "Test",
        status: "success",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("should send fail notification when telegramNotifyOnFail is undefined (default)", async () => {
      const settings = { ...enabledSettings };
      delete (settings as any).telegramNotifyOnFail;
      vi.mocked(storageService.getSettings).mockReturnValue(settings);

      await TelegramService.notifyTaskComplete({
        taskTitle: "Test",
        status: "fail",
        error: "err",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("should escape HTML in task title", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(enabledSettings);

      await TelegramService.notifyTaskComplete({
        taskTitle: "<script>alert('xss')</script>",
        status: "success",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("&lt;script&gt;");
      expect(body.text).not.toContain("<script>");
    });

    it("should use correct language translations", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ...enabledSettings,
        language: "zh",
      });

      await TelegramService.notifyTaskComplete({
        taskTitle: "测试视频",
        status: "success",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("任务成功");
      expect(body.text).toContain("标题");
    });

    it("should fall back to English for unknown language", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ...enabledSettings,
        language: "xx",
      });

      await TelegramService.notifyTaskComplete({
        taskTitle: "Test",
        status: "success",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("Task Success");
    });

    it("should log error and not throw on fetch failure", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(enabledSettings);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ description: "Bad Request: chat not found" }),
      });

      await expect(
        TelegramService.notifyTaskComplete({
          taskTitle: "Test",
          status: "success",
        })
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send notification")
      );
    });

    it("should not include source URL when not provided", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(enabledSettings);

      await TelegramService.notifyTaskComplete({
        taskTitle: "Test",
        status: "success",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).not.toContain("URL:");
    });
  });

  describe("sendTestMessage", () => {
    it("should return ok: true on success", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(enabledSettings);

      const result = await TelegramService.sendTestMessage("token", "chat-id");

      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledOnce();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.chat_id).toBe("chat-id");
      expect(body.text).toContain("test successful");
    });

    it("should return ok: false with error on failure", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(enabledSettings);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ description: "Unauthorized" }),
      });

      const result = await TelegramService.sendTestMessage("bad-token", "chat-id");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unauthorized");
    });

    it("should use localized test message", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ...enabledSettings,
        language: "zh",
      });

      await TelegramService.sendTestMessage("token", "chat-id");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("通知测试成功");
    });
  });
});
