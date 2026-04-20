import fs from "fs";
import path from "path";

const PACKAGE_JSON_PATH = path.resolve(__dirname, "..", "..", "package.json");
const BANNER_CONTENT_WIDTH = 45;
const BANNER_BORDER = `╔${"═".repeat(BANNER_CONTENT_WIDTH + 2)}╗`;
const BANNER_FOOTER = `╚${"═".repeat(BANNER_CONTENT_WIDTH + 2)}╝`;

function formatBannerLine(content: string = ""): string {
  return `║ ${content.slice(0, BANNER_CONTENT_WIDTH).padEnd(BANNER_CONTENT_WIDTH)} ║`;
}

function getPackageVersion(): string {
  try {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      version?: unknown;
    };
    return typeof packageJson.version === "string" && packageJson.version.trim()
      ? packageJson.version.trim()
      : "unknown";
  } catch {
    return "unknown";
  }
}

function getBuildDate(): string {
  return (
    process.env.MYTUBE_BUILD_DATE?.trim() ||
    process.env.BUILD_DATE?.trim() ||
    "unknown"
  );
}

/**
 * MyTube Backend Version Information
 */
export const VERSION = {
  number: getPackageVersion(),
  buildDate: getBuildDate(),
  name: "MyTube Backend Server",
  displayVersion: function () {
    console.log([
      "",
      BANNER_BORDER,
      formatBannerLine(),
      formatBannerLine(this.name),
      formatBannerLine(`Version: ${this.number}`),
      formatBannerLine(`Build Date: ${this.buildDate}`),
      formatBannerLine(),
      BANNER_FOOTER,
      "",
    ].join("\n"));
  },
};
