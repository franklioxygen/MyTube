import { describe, expect, it, vi } from "vitest";
import {
  configureMissAvPage,
  deriveNonHeadlessUserAgent,
  getMissAvPuppeteerLaunchOptions,
} from "../../../services/downloaders/missav/puppeteer";

vi.mock("../../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderPluginPath: vi.fn(() => ""),
  getProviderScript: vi.fn(() => ""),
}));

describe("deriveNonHeadlessUserAgent", () => {
  it("rewrites only the headless marker, leaving platform and version alone", () => {
    // Verified against Chrome 152: headless reports HeadlessChrome/<version>
    // where headful reports Chrome/<version>, and nothing else differs.
    expect(
      deriveNonHeadlessUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/152.0.0.0 Safari/537.36",
      ),
    ).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
  });

  it("leaves a headful User-Agent untouched", () => {
    const headful =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

    expect(deriveNonHeadlessUserAgent(headful)).toBeNull();
  });

  it("returns null when the browser reports nothing usable", () => {
    expect(deriveNonHeadlessUserAgent(undefined)).toBeNull();
    expect(deriveNonHeadlessUserAgent("")).toBeNull();
  });
});

describe("configureMissAvPage", () => {
  it("replaces a headless User-Agent with the browser's own de-headlessed one", async () => {
    const setUserAgent = vi.fn();
    const page = {
      setExtraHTTPHeaders: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setUserAgent,
      browser: () => ({
        userAgent: async () =>
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/152.0.0.0 Safari/537.36",
      }),
    };

    await configureMissAvPage(page);

    // Deriving it from the running browser is what keeps the platform and
    // version honest; a hardcoded string is what put a macOS UA on a Linux
    // container in the first place.
    expect(setUserAgent).toHaveBeenCalledWith(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
  });

  it("leaves the User-Agent alone when the browser is already headful", async () => {
    const setUserAgent = vi.fn();
    const page = {
      setExtraHTTPHeaders: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setUserAgent,
      browser: () => ({
        userAgent: async () =>
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
      }),
    };

    await configureMissAvPage(page);

    expect(setUserAgent).not.toHaveBeenCalled();
  });

  it("still configures the page when the browser handle is unreachable", async () => {
    const page = {
      setExtraHTTPHeaders: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setUserAgent: vi.fn(),
      browser: () => {
        throw new Error("detached");
      },
    };

    await configureMissAvPage(page);

    // An honest-but-headless User-Agent beats failing the page load outright.
    expect(page.setExtraHTTPHeaders).toHaveBeenCalled();
    expect(page.evaluateOnNewDocument).toHaveBeenCalled();
  });
});

describe("getMissAvPuppeteerLaunchOptions", () => {
  it("does not hardcode a User-Agent at launch", () => {
    // A launch-time string cannot know the browser's real version or platform,
    // which is how a macOS UA ended up on a Linux container.
    const args = getMissAvPuppeteerLaunchOptions()?.args ?? [];

    expect(args.some((arg) => arg.startsWith("--user-agent"))).toBe(false);
  });
});
