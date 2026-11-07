import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareBilibiliDownloadFlags } from "../../services/downloaders/bilibili/bilibiliConfig";
import { prepareDownloadFlags } from "../../services/downloaders/ytdlp/ytdlpConfig";
import * as storageService from "../../services/storageService";
import { logger, LogLevel } from "../../utils/logger";
import { parseYtDlpConfig } from "../../utils/ytdlp/config";
import { getUserYtDlpConfig } from "../../utils/ytDlpUtils";

// These run the real functions with the real logger: the point is what actually
// reaches stdout and stderr on a proxied download, not what a mock was given.
vi.mock("../../services/storageService", async (importOriginal) => ({
  ...(await importOriginal<typeof storageService>()),
  getSettings: vi.fn(),
}));

const PASSWORD = "s3cr3t-pw";

// Every proxy form yt-dlp accepts that reaches the logs through a config line.
const PROXY_FORMS = [
  `http://user:${PASSWORD}@host:1`,
  `socks5h://user:${PASSWORD}%@host:1`,
  `http://user:${PASSWORD}/x@host:1`,
  `http://user:${PASSWORD} x@host:1`,
  `user:${PASSWORD}@host:1`,
  `//user:${PASSWORD}@host:1`,
];

describe("proxy credentials at real log sites", () => {
  let written: string[];

  const capture = (chunk: unknown): boolean => {
    written.push(String(chunk));
    return true;
  };

  beforeEach(() => {
    written = [];
    // The shared logger takes its level from the environment at import.
    logger.setLevel(LogLevel.DEBUG);
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
      written.push(args.map((arg) => JSON.stringify(arg)).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const useProxy = (proxy: string): void => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      ytDlpConfig: `--proxy ${proxy}`,
    } as ReturnType<typeof storageService.getSettings>);
  };

  const expectRedactedLine = (marker: string): void => {
    const line = written.find((text) => text.includes(marker));
    expect(line, `expected a log line with "${marker}"`).toBeDefined();
    expect(line).toContain("[REDACTED]@host:1");
  };

  it.each(PROXY_FORMS)("should keep the config line intact for %s", (proxy) => {
    // Guards the tests below: they only prove something if the raw value really
    // gets through parsing, spaces and all, to be logged.
    expect(parseYtDlpConfig(`--proxy ${proxy}`).proxy).toBe(proxy);
  });

  it.each(PROXY_FORMS)("should not log the password for %s", (proxy) => {
    useProxy(proxy);

    const config = getUserYtDlpConfig("https://www.youtube.com/watch?v=abc");
    prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc",
      "/tmp/mytube-proxy-log-sites/video.mp4",
      config as Parameters<typeof prepareDownloadFlags>[2]
    );
    prepareBilibiliDownloadFlags(
      "https://www.bilibili.com/video/BV1xx411c7mD",
      "/tmp/mytube-proxy-log-sites/%(title)s.%(ext)s"
    );

    expectRedactedLine("Parsed user yt-dlp config:");
    expectRedactedLine("Preserving proxy in networkOptions:");
    expectRedactedLine("Proxy in final flags:");
    expectRedactedLine("Final yt-dlp flags:");
    expectRedactedLine("Final Bilibili yt-dlp flags:");
    expect(written.join("\n")).not.toContain(PASSWORD);
  });
});
