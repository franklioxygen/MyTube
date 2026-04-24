/* eslint-disable @typescript-eslint/no-explicit-any */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rssMocks = vi.hoisted(() => ({
  buildErrorRssXml: vi.fn(
    (opts: { title: string; link: string; description: string }) =>
      `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${opts.title}</title>
    <link>${opts.link}</link>
    <description>${opts.description}</description>
    <lastBuildDate>Fri, 24 Apr 2026 00:00:00 GMT</lastBuildDate>
  </channel>
</rss>`
  ),
  buildRssXml: vi.fn(() => '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"></rss>'),
  getBaseUrl: vi.fn(() => "https://mytube.example"),
  getRssToken: vi.fn(),
  getVideosForRss: vi.fn(),
  recordAccess: vi.fn(() => Promise.resolve()),
  rssTokenLogId: vi.fn(() => "token-log-id"),
}));

vi.mock("../../services/rssService", () => ({
  buildErrorRssXml: rssMocks.buildErrorRssXml,
  buildRssXml: rssMocks.buildRssXml,
  getBaseUrl: rssMocks.getBaseUrl,
  getRssToken: rssMocks.getRssToken,
  getVideosForRss: rssMocks.getVideosForRss,
  recordAccess: rssMocks.recordAccess,
  rssTokenLogId: rssMocks.rssTokenLogId,
  setRssNoStoreHeaders: (res: any) => {
    res.set("Cache-Control", "private, no-store");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
  },
}));

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(() => ({ language: "zh" })),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

import { serveFeed } from "../../controllers/rssController";

const baseToken = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  label: "All videos",
  role: "visitor" as const,
  filters: { maxItems: 10 },
  isActive: true,
  accessCount: 0,
  lastAccessedAt: null,
  createdAt: 1710000000000,
  updatedAt: 1710000000000,
};

const buildApp = () => {
  const app = express();
  app.get("/feed/:token", (req, res, next) => {
    void serveFeed(req, res).catch(next);
  });
  return app;
};

const expectRssNoStoreHeaders = (response: request.Response) => {
  expect(response.headers["content-type"]).toContain("application/rss+xml");
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers.pragma).toBe("no-cache");
  expect(response.headers.expires).toBe("0");
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["referrer-policy"]).toBe("no-referrer");
};

describe("rssController serveFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rssMocks.getBaseUrl.mockReturnValue("https://mytube.example");
    rssMocks.recordAccess.mockResolvedValue(undefined);
  });

  it("returns RSS XML with no-store headers and records access for an active token", async () => {
    const token = { ...baseToken };
    const videos = [{ id: "video-1", title: "Video" }];
    const xml = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel /></rss>';
    rssMocks.getRssToken.mockResolvedValue(token);
    rssMocks.getVideosForRss.mockResolvedValue(videos);
    rssMocks.buildRssXml.mockReturnValue(xml);

    const response = await request(buildApp()).get(`/feed/${token.id}`);

    expect(response.status).toBe(200);
    expectRssNoStoreHeaders(response);
    expect(response.text).toBe(xml);
    expect(rssMocks.getVideosForRss).toHaveBeenCalledWith(token.filters, "visitor");
    expect(rssMocks.buildRssXml).toHaveBeenCalledWith(
      videos,
      token,
      "https://mytube.example",
      { language: "zh" }
    );
    expect(rssMocks.recordAccess).toHaveBeenCalledWith(token.id);
  });

  it("returns indistinguishable 404 RSS XML for disabled tokens", async () => {
    rssMocks.getRssToken.mockResolvedValue({ ...baseToken, isActive: false });

    const response = await request(buildApp()).get(`/feed/${baseToken.id}`);

    expect(response.status).toBe(404);
    expectRssNoStoreHeaders(response);
    expect(response.text).toContain("<rss version=\"2.0\">");
    expect(response.text).toContain("<title>Error</title>");
    expect(response.text).toContain("<description>Feed not found or disabled</description>");
    expect(rssMocks.getVideosForRss).not.toHaveBeenCalled();
    expect(rssMocks.recordAccess).not.toHaveBeenCalled();
  });

  it("returns RSS XML for malformed token paths without revealing token state", async () => {
    const response = await request(buildApp()).get("/feed/short");

    expect(response.status).toBe(404);
    expectRssNoStoreHeaders(response);
    expect(response.text).toContain("<description>Feed not found or disabled</description>");
    expect(rssMocks.getRssToken).not.toHaveBeenCalled();
  });
});
