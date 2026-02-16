import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn().mockReturnValue({ language: "en" }),
}));

// Mock the telegramService module used by the controller via dynamic import
const mockSendTestMessage = vi.fn();
vi.mock("../../services/telegramService", () => ({
  TelegramService: {
    sendTestMessage: (...args: any[]) => mockSendTestMessage(...args),
  },
}));

import { testTelegramNotification } from "../settingsController";

describe("testTelegramNotification", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    req = { body: {} };
    res = {
      json: jsonMock,
      status: statusMock,
    } as unknown as Response;
  });

  it("should return 400 when botToken is missing", async () => {
    req.body = { chatId: "123" };
    await testTelegramNotification(req as Request, res as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("required") })
    );
  });

  it("should return 400 when chatId is missing", async () => {
    req.body = { botToken: "token" };
    await testTelegramNotification(req as Request, res as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return success when test message succeeds", async () => {
    req.body = { botToken: "valid-token", chatId: "valid-chat" };
    mockSendTestMessage.mockResolvedValue({ ok: true });

    await testTelegramNotification(req as Request, res as Response);

    expect(mockSendTestMessage).toHaveBeenCalledWith("valid-token", "valid-chat");
    expect(jsonMock).toHaveBeenCalledWith({ success: true });
  });

  it("should return 400 when test message fails", async () => {
    req.body = { botToken: "bad-token", chatId: "bad-chat" };
    mockSendTestMessage.mockResolvedValue({ ok: false, error: "chat not found" });

    await testTelegramNotification(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error: "chat not found" });
  });
});
