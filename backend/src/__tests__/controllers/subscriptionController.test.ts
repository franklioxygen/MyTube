import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    createSubscription,
    deleteSubscription,
    getSubscriptions,
} from "../../controllers/subscriptionController";
import { ValidationError } from "../../errors/DownloadErrors";
import { continuousDownloadService } from "../../services/continuousDownloadService";
import { subscriptionService } from "../../services/subscriptionService";
import { logger } from "../../utils/logger";

vi.mock("../../services/subscriptionService");
vi.mock("../../services/continuousDownloadService");
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SubscriptionController", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = {
      body: {},
      params: {},
    };
    res = {
      json,
      status,
    };
  });

  describe("createSubscription", () => {
    it("should create a subscription", async () => {
      req.body = {
        url: "https://www.youtube.com/@testuser",
        interval: 60,
        downloadShorts: true,
      };
      const mockSubscription = {
        id: "sub-123",
        url: "https://www.youtube.com/@testuser",
        interval: 60,
        author: "@testuser",
        platform: "YouTube",
        downloadShorts: 1,
      };
      (subscriptionService.subscribe as any).mockResolvedValue(
        mockSubscription
      );

      await createSubscription(req as Request, res as Response);

      expect(logger.info).toHaveBeenCalledWith("Creating subscription:", {
        url: "https://www.youtube.com/@testuser",
        interval: 60,
        authorName: undefined,
        downloadAllPrevious: undefined,
        downloadShorts: true,
      });
      expect(subscriptionService.subscribe).toHaveBeenCalledWith(
        "https://www.youtube.com/@testuser",
        60,
        undefined,
        true
      );
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(mockSubscription);
    });

    it("should create backfill tasks when downloadAllPrevious and downloadShorts are true", async () => {
      req.body = {
        url: "https://www.youtube.com/@testuser",
        interval: 60,
        downloadAllPrevious: true,
        downloadShorts: true,
      };
      const mockSubscription = {
        id: "sub-123",
        url: "https://www.youtube.com/@testuser",
        interval: 60,
        author: "@testuser",
        platform: "YouTube",
      };
      (subscriptionService.subscribe as any).mockResolvedValue(
        mockSubscription
      );
      (continuousDownloadService.createTask as any).mockResolvedValue(undefined);

      await createSubscription(req as Request, res as Response);

      expect(continuousDownloadService.createTask).toHaveBeenCalledTimes(2);
      expect(continuousDownloadService.createTask).toHaveBeenNthCalledWith(
        1,
        "https://www.youtube.com/@testuser",
        "@testuser",
        "YouTube",
        "sub-123"
      );
      expect(continuousDownloadService.createTask).toHaveBeenNthCalledWith(
        2,
        "https://www.youtube.com/@testuser/shorts",
        "@testuser (Shorts)",
        "YouTube",
        "sub-123"
      );
    });

    it("should throw ValidationError when URL is missing", async () => {
      req.body = { interval: 60 };

      await expect(
        createSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);

      expect(subscriptionService.subscribe).not.toHaveBeenCalled();
    });

    it("should throw ValidationError when interval is missing", async () => {
      req.body = { url: "https://www.youtube.com/@testuser" };

      await expect(
        createSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);

      expect(subscriptionService.subscribe).not.toHaveBeenCalled();
    });

    it("should throw ValidationError when both URL and interval are missing", async () => {
      req.body = {};

      await expect(
        createSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("getSubscriptions", () => {
    it("should return all subscriptions", async () => {
      const mockSubscriptions = [
        { id: "sub-1", url: "https://www.youtube.com/@test1", interval: 60 },
        { id: "sub-2", url: "https://space.bilibili.com/123", interval: 120 },
      ];
      (subscriptionService.listSubscriptions as any).mockResolvedValue(
        mockSubscriptions
      );

      await getSubscriptions(req as Request, res as Response);

      expect(subscriptionService.listSubscriptions).toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(mockSubscriptions);
      expect(status).not.toHaveBeenCalled(); // Default status is 200
    });

    it("should return empty array when no subscriptions", async () => {
      (subscriptionService.listSubscriptions as any).mockResolvedValue([]);

      await getSubscriptions(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith([]);
    });
  });

  describe("deleteSubscription", () => {
    it("should delete a subscription", async () => {
      req.params = { id: "sub-123" };
      (subscriptionService.unsubscribe as any).mockResolvedValue(undefined);

      await deleteSubscription(req as Request, res as Response);

      expect(subscriptionService.unsubscribe).toHaveBeenCalledWith("sub-123");
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        success: true,
        message: "Subscription deleted",
      });
    });
  });
});
