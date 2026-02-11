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

import { configureRateLimiting } from "../../server/rateLimit";
import { getClientIp } from "../../utils/security";

describe("configureRateLimiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.createdLimiters.length = 0;
  });

  it("creates general + auth limiters and returns auth limiter", () => {
    const app = { use: vi.fn() } as any;

    const authLimiter = configureRateLimiting(app);

    expect(mocked.rateLimitFactory).toHaveBeenCalledTimes(2);
    expect(mocked.createdLimiters[1]).toBe(authLimiter);
    expect(app.use).toHaveBeenCalledTimes(1);

    const generalOptions = (mocked.createdLimiters[0] as any).__options;
    const authOptions = (mocked.createdLimiters[1] as any).__options;

    expect(generalOptions.max).toBe(1000);
    expect(authOptions.max).toBe(5);
    expect(authOptions.skipSuccessfulRequests).toBe(true);

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
});
