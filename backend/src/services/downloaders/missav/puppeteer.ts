import path from "path";
import puppeteer from "puppeteer";
import { logger } from "../../../utils/logger";
import { pathExistsTrustedSync } from "../../../utils/security";
import {
  MISSAV_BROWSER_ACCEPT_LANGUAGE,
  MISSAV_BROWSER_USER_AGENT,
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

export function getMissAvPuppeteerLaunchOptions(): Parameters<
  typeof puppeteer.launch
>[0] {
  return {
    headless: resolvePuppeteerHeadlessMode(),
    executablePath: resolvePuppeteerExecutablePath(),
    defaultViewport: {
      width: 1280,
      height: 900,
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,900",
      `--user-agent=${MISSAV_BROWSER_USER_AGENT}`,
    ],
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
