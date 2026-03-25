/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const createdLimiters: Array<ReturnType<typeof vi.fn>> = [];
  const rateLimitFactory = vi.fn((options: any) => {
    const handler = vi.fn((_req, _res, next) => next());
    (handler as any).__options = options;
    createdLimiters.push(handler);
    return handler;
  });
  return {
    createdLimiters,
    rateLimitFactory,
  };
});

vi.mock("express-rate-limit", () => ({
  default: mocked.rateLimitFactory,
}));

vi.mock("../../utils/security", () => ({
  getClientIp: vi.fn(() => "203.0.113.1"),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

import { configureRateLimiting } from "../../server/rateLimit";
import { getClientIp } from "../../utils/security";
import { logger } from "../../utils/logger";

describe("configureRateLimiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.createdLimiters.length = 0;
  });

  it("creates general + scoped auth limiters and returns the limiter set", () => {
    const app = { use: vi.fn() } as any;

    const authLimiters = configureRateLimiting(app);

    expect(mocked.rateLimitFactory).toHaveBeenCalledTimes(7);
    expect(mocked.createdLimiters[1]).toBe(authLimiters.adminPasswordLimiter);
    expect(mocked.createdLimiters[2]).toBe(authLimiters.visitorPasswordLimiter);
    expect(mocked.createdLimiters[3]).toBe(authLimiters.adminReauthLimiter);
    expect(mocked.createdLimiters[4]).toBe(authLimiters.resetPasswordLimiter);
    expect(mocked.createdLimiters[5]).toBe(authLimiters.passkeyAuthLimiter);
    expect(mocked.createdLimiters[6]).toBe(authLimiters.passkeyRegistrationLimiter);
    expect(app.use).toHaveBeenCalledTimes(1);

    const generalOptions = (mocked.createdLimiters[0] as any).__options;
    const authOptions = (mocked.createdLimiters[1] as any).__options;

    expect(generalOptions.max).toBe(1000);
    expect(authOptions.max).toBe(5);
    expect(authOptions.skipSuccessfulRequests).toBe(true);
    expect(typeof authOptions.handler).toBe("function");

    const req = { path: "/api/anything" } as any;
    expect(generalOptions.keyGenerator(req)).toBe("203.0.113.1");
    expect(getClientIp).toHaveBeenCalledWith(req);
  });

  it("bypasses static/media and known API paths", () => {
    const app = { use: vi.fn() } as any;
    configureRateLimiting(app);

    const middleware = app.use.mock.calls[0][0];
    const generalLimiter = mocked.createdLimiters[0];
    const next = vi.fn();

    middleware({ path: "/videos/abc.mp4" }, {}, next);
    middleware({ path: "/api/download" }, {}, next);
    middleware({ path: "/api/check-playlist" }, {}, next);
    middleware({ path: "/api/settings/password-enabled" }, {}, next);

    expect(next).toHaveBeenCalledTimes(4);
    expect(generalLimiter).not.toHaveBeenCalled();
  });

  it("uses general limiter for normal API endpoints", () => {
    const app = { use: vi.fn() } as any;
    configureRateLimiting(app);

    const middleware = app.use.mock.calls[0][0];
    const generalLimiter = mocked.createdLimiters[0];
    const next = vi.fn();

    middleware({ path: "/api/videos" }, {}, next);

    expect(generalLimiter).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("logs scoped auth throttling and returns a wait time payload", () => {
    const app = { use: vi.fn() } as any;
    const authLimiters = configureRateLimiting(app);
    const authOptions = (authLimiters.adminPasswordLimiter as any).__options;
    const json = vi.fn();
    const res = {
      status: vi.fn(() => ({ json })),
    } as any;
    const req = {
      method: "POST",
      path: "/api/settings/verify-admin-password",
      rateLimit: {
        resetTime: Date.now() + 12_000,
      },
    } as any;

    authOptions.handler(req, res);

    expect(logger.warn).toHaveBeenCalledWith(
      "Authentication rate limit triggered",
      expect.objectContaining({
        scope: "admin-password",
        ip: "203.0.113.1",
        method: "POST",
        path: "/api/settings/verify-admin-password",
        maxAttempts: 5,
      })
    );
    expect(res.status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        waitTime: expect.any(Number),
        statusCode: 429,
      })
    );
  });
});
