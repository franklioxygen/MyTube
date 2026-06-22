import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  getConfig,
} from "../../controllers/liveTranslationController";
import * as storageService from "../../services/storageService";
import * as passwordService from "../../services/passwordService";
import { __resetTicketsForTest } from "../../services/liveTranslation/sessionTickets";

vi.mock("../../services/storageService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/storageService")>();
  return { ...actual, getSettings: vi.fn() };
});
vi.mock("../../services/passwordService");

const enabledSettings = {
  liveTranslationEnabled: true,
  liveTranslationModel: "gemini-3.5-live-translate-preview",
  liveTranslationApiKey: "secret-key",
  liveTranslationSourceLanguage: "auto",
  liveTranslationTargetLanguage: "en",
};

describe("liveTranslationController", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetTicketsForTest();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = { body: {}, cookies: {} };
    res = { json, status } as Partial<Response>;
  });

  describe("getConfig", () => {
    it("returns canUse true for an admin when fully configured (login on)", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(true);
      (storageService.getSettings as any).mockReturnValue(enabledSettings);
      req.user = { role: "admin" } as any;

      await getConfig(req as Request, res as Response);

      const payload = json.mock.calls[0][0];
      expect(payload.available).toBe(true);
      expect(payload.canUse).toBe(true);
      expect(payload.apiKeyConfigured).toBe(true);
      expect(payload.reason).toBeNull();
    });

    it("returns feature_disabled when the feature is off", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(false);
      (storageService.getSettings as any).mockReturnValue({ liveTranslationEnabled: false });

      await getConfig(req as Request, res as Response);

      const payload = json.mock.calls[0][0];
      expect(payload.enabled).toBe(false);
      expect(payload.canUse).toBe(false);
      expect(payload.reason).toBe("feature_disabled");
    });

    it("returns api_key_missing when enabled without a key", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(false);
      (storageService.getSettings as any).mockReturnValue({
        ...enabledSettings,
        liveTranslationApiKey: "",
      });

      await getConfig(req as Request, res as Response);

      const payload = json.mock.calls[0][0];
      expect(payload.available).toBe(false);
      expect(payload.apiKeyConfigured).toBe(false);
      expect(payload.reason).toBe("api_key_missing");
    });

    it("returns admin_required for a visitor when login is enabled", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(true);
      (storageService.getSettings as any).mockReturnValue(enabledSettings);
      req.user = { role: "visitor" } as any;

      await getConfig(req as Request, res as Response);

      const payload = json.mock.calls[0][0];
      expect(payload.available).toBe(false);
      expect(payload.canUse).toBe(false);
      expect(payload.apiKeyConfigured).toBe(false);
      expect(payload.reason).toBe("admin_required");
    });

    it("does not reveal missing API-key state to visitors when login is enabled", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(true);
      (storageService.getSettings as any).mockReturnValue({
        ...enabledSettings,
        liveTranslationApiKey: "",
      });
      req.user = { role: "visitor" } as any;

      await getConfig(req as Request, res as Response);

      const payload = json.mock.calls[0][0];
      expect(payload.available).toBe(false);
      expect(payload.canUse).toBe(false);
      expect(payload.apiKeyConfigured).toBe(false);
      expect(payload.reason).toBe("admin_required");
    });

    it("rejects API-key-authenticated clients", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(false);
      (storageService.getSettings as any).mockReturnValue(enabledSettings);
      req.apiKeyAuthenticated = true;

      await getConfig(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(403);
    });
  });

  describe("createSession", () => {
    it("mints a ticket for an admin when login is enabled", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(true);
      (storageService.getSettings as any).mockReturnValue(enabledSettings);
      req.user = { role: "admin" } as any;
      req.body = { videoId: "abc123" };

      await createSession(req as Request, res as Response);

      const payload = json.mock.calls[0][0];
      expect(payload.ticket).toBeTruthy();
      expect(payload.wsPath).toBe("/api/live-translation/ws");
      expect(payload.config.targetLanguage).toBe("en");
      // The secret must never appear in the response.
      expect(JSON.stringify(payload)).not.toContain("secret-key");
    });

    it("mints a ticket when login is disabled (no user)", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(false);
      (storageService.getSettings as any).mockReturnValue(enabledSettings);
      req.body = { videoId: "abc123" };

      await createSession(req as Request, res as Response);

      expect(json.mock.calls[0][0].ticket).toBeTruthy();
    });

    it("rejects a visitor when login is enabled", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(true);
      (storageService.getSettings as any).mockReturnValue(enabledSettings);
      req.user = { role: "visitor" } as any;
      req.body = { videoId: "abc123" };

      await createSession(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(403);
      expect(json.mock.calls[0][0].reason).toBe("admin_required");
    });

    it("rejects API-key-authenticated clients", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(false);
      (storageService.getSettings as any).mockReturnValue(enabledSettings);
      req.apiKeyAuthenticated = true;
      req.body = { videoId: "abc123" };

      await createSession(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(403);
    });

    it("rejects when the feature is unavailable", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(false);
      (storageService.getSettings as any).mockReturnValue({ liveTranslationEnabled: false });
      req.body = { videoId: "abc123" };

      await createSession(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(400);
      expect(json.mock.calls[0][0].reason).toBe("feature_disabled");
    });

    it("requires a videoId", async () => {
      (passwordService.isLoginRequired as any).mockReturnValue(false);
      (storageService.getSettings as any).mockReturnValue(enabledSettings);
      req.body = {};

      await createSession(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(400);
    });
  });
});
