import path from "path";
import puppeteer from "puppeteer";
import { logger } from "../../../utils/logger";
import { pathExistsTrustedSync } from "../../../utils/security";
import {
  MISSAV_BROWSER_ACCEPT_LANGUAGE,
  PUPPETEER_LINUX_EXECUTABLE_PATHS,
  PUPPETEER_MACOS_EXECUTABLE_PATHS,
} from "./constants";
import { isCloudflareChallengeHtml } from "./navigation";

function resolvePuppeteerExecutablePath(): string | undefined {
  const overridePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (overridePath) {
    return overridePath;
  }

  const windowsPaths = [
    process.env["PROGRAMFILES"]
      ? path.join(
          process.env["PROGRAMFILES"],
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
    process.env["PROGRAMFILES(X86)"]
      ? path.join(
          process.env["PROGRAMFILES(X86)"],
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
  ].filter((candidate): candidate is string => Boolean(candidate));

  const candidatePaths =
    process.platform === "darwin"
      ? PUPPETEER_MACOS_EXECUTABLE_PATHS
      : process.platform === "win32"
        ? windowsPaths
        : PUPPETEER_LINUX_EXECUTABLE_PATHS;

  const resolvedPath = candidatePaths.find((candidatePath) =>
    pathExistsTrustedSync(candidatePath),
  );
  if (resolvedPath) {
    logger.info(`Using system Chrome for Puppeteer: ${resolvedPath}`);
  }

  return resolvedPath;
}

function resolvePuppeteerHeadlessMode(): boolean {
  const override = process.env.PUPPETEER_HEADLESS?.trim().toLowerCase();
  if (override === "false" || override === "0" || override === "no") {
    return false;
  }

  return true;
}

/**
 * Launch options for the page load that discovers a MissAV m3u8 URL.
 *
 * `userConfig` is the resolved yt-dlp config for the URL being fetched. Only
 * its proxy matters here, and only in one direction: an empty string is
 * yt-dlp's "connect directly" value, which proxyOnlyYoutube sets to override a
 * proxy inherited from the environment. Chromium reads `http_proxy` from that
 * same environment, so without being told otherwise the browser step would keep
 * taking the proxy the download it feeds has just left - and if that proxy is
 * slow or cannot reach MissAV, the operation fails here, before the direct
 * yt-dlp invocation is ever reached.
 *
 * A configured proxy is deliberately not forwarded the other way: Chromium's
 * --proxy-server takes no inline credentials, so a proxy carrying them would be
 * silently downgraded rather than honoured.
 */
export function getMissAvPuppeteerLaunchOptions(
  userConfig?: { proxy?: unknown },
): Parameters<typeof puppeteer.launch>[0] {
  // Deliberately no --user-agent override. A hardcoded macOS Chrome string used
  // to be forced here, but Chromium does not rewrite everything to match it:
  // the Sec-CH-UA-Platform client hint, navigator.platform and the WebGL
  // renderer all keep reporting the real platform, which in Docker is Linux.
  // A macOS User-Agent arriving beside Linux client hints in the same request
  // is a direct contradiction and one of the cheapest bot-detection signals
  // there is, so the override made the browser easier to single out rather
  // than harder. Chromium's own string is consistent with everything else it
  // reports.
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,900",
  ];

  if (userConfig?.proxy === "") {
    // Overrides any proxy Chromium would otherwise pick up from the environment.
    args.push("--no-proxy-server");
  }

  return {
    headless: resolvePuppeteerHeadlessMode(),
    executablePath: resolvePuppeteerExecutablePath(),
    defaultViewport: {
      width: 1280,
      height: 900,
    },
    args,
  };
}

export async function configureMissAvPage(page: {
  setExtraHTTPHeaders?: (headers: Record<string, string>) => Promise<unknown>;
  evaluateOnNewDocument?: (fn: () => void) => Promise<unknown>;
}): Promise<void> {
  await page.setExtraHTTPHeaders?.({
    "accept-language": MISSAV_BROWSER_ACCEPT_LANGUAGE,
  });
  await page.evaluateOnNewDocument?.(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
      configurable: true,
    });
  });
}

export async function navigateMissAvPage(
  page: {
    goto: (
      url: string,
      options: { waitUntil: "domcontentloaded"; timeout: number },
    ) => Promise<unknown>;
    title?: () => Promise<string>;
    content?: () => Promise<string>;
    waitForFunction?: (
      pageFunction: () => boolean,
      options: { timeout: number },
    ) => Promise<unknown>;
  },
  safeNavigationUrl: string,
): Promise<void> {
  logger.info("Navigating to:", safeNavigationUrl);
  await page.goto(safeNavigationUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const title = typeof page.title === "function" ? await page.title() : "";
  if (title === "Just a moment..." && typeof page.waitForFunction === "function") {
    logger.info(
      "Cloudflare verification page detected; waiting up to 30 s for automatic completion...",
    );
    try {
      await page.waitForFunction(
        () =>
          document.title !== "Just a moment..." &&
          !document.body.innerText.includes("Performing security verification"),
        { timeout: 30000 },
      );
    } catch (error) {
      const html = typeof page.content === "function" ? await page.content() : "";
      if (isCloudflareChallengeHtml(html)) {
        throw new Error(
          "MissAV access is blocked by Cloudflare verification. Retry with PUPPETEER_HEADLESS=false if needed.",
        );
      }
      throw error;
    }
  }
}
