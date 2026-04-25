import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { configureRateLimiting } from "../../server/rateLimit";

describe("RSS feed rate limit integration", () => {
  it("returns RSS XML with no-store headers when the feed limiter rejects a request", async () => {
    const app = express();
    const authLimiters = configureRateLimiting(app);
    app.get("/feed/:token", authLimiters.feedLimiter, (_req, res) => {
      res.type("application/rss+xml; charset=utf-8").send("<rss></rss>");
    });

    for (let i = 0; i < 30; i += 1) {
      const allowed = await request(app).get("/feed/550e8400-e29b-41d4-a716-446655440000");
      expect(allowed.status).toBe(200);
    }

    const limited = await request(app).get("/feed/550e8400-e29b-41d4-a716-446655440000");

    expect(limited.status).toBe(429);
    expect(limited.headers["content-type"]).toContain("application/rss+xml");
    expect(limited.headers["cache-control"]).toBe("private, no-store");
    expect(limited.headers["referrer-policy"]).toBe("no-referrer");
    expect(limited.text).toContain("<rss version=\"2.0\">");
    expect(limited.text).toContain("<title>Rate limit exceeded</title>");
  });
});
