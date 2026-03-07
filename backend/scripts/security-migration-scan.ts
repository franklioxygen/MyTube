#!/usr/bin/env ts-node

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {
  formatSecurityMigrationScanReportMarkdown,
  scanSecurityMigrationState,
} from "../src/services/securityMigrationScanService";

dotenv.config();

type OutputFormat = "json" | "markdown";

interface ParsedArgs {
  format: OutputFormat;
  outPath?: string;
  printToStdout: boolean;
  assertClean: boolean;
  securityModel?: string;
  hooksDir?: string;
  platformMountDirectoriesRaw?: string;
  includeManualChecks: boolean;
}

const printUsage = (): void => {
  console.log("Security migration scan script");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npm run security-migration:scan -- [--format json|markdown] [--out <file>] [--print]"
  );
  console.log(
    "  npm run security-migration:scan -- [--assert-clean] [--security-model strict|legacy]"
  );
  console.log("");
  console.log("Options:");
  console.log("  --format <json|markdown>      Output format (default: markdown)");
  console.log("  --out <path>                  Write report to file path");
  console.log("  --print                       Always print report to stdout");
  console.log("  --assert-clean                Exit non-zero when high-risk items exist");
  console.log("  --security-model <value>      Override SECURITY_MODEL for scan");
  console.log("  --hooks-dir <path>            Override hooks directory path");
  console.log(
    "  --platform-mount-config <json> Override PLATFORM_MOUNT_DIRECTORIES raw JSON"
  );
  console.log("  --no-manual-checks            Skip manual check reminder items");
  console.log("  --help                        Show this help message");
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {
    format: "markdown",
    outPath: undefined,
    printToStdout: false,
    assertClean: false,
    securityModel: undefined,
    hooksDir: undefined,
    platformMountDirectoriesRaw: undefined,
    includeManualChecks: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--print") {
      parsed.printToStdout = true;
      continue;
    }
    if (arg === "--assert-clean") {
      parsed.assertClean = true;
      continue;
    }
    if (arg === "--no-manual-checks") {
      parsed.includeManualChecks = false;
      continue;
    }
    if (arg === "--format") {
      const nextArg = argv[index + 1];
      if (nextArg !== "json" && nextArg !== "markdown") {
        throw new Error("Invalid --format value. Use json or markdown.");
      }
      parsed.format = nextArg;
      index += 1;
      continue;
    }
    if (arg === "--out") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing --out path value.");
      }
      parsed.outPath = nextArg;
      index += 1;
      continue;
    }
    if (arg === "--security-model") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing --security-model value.");
      }
      parsed.securityModel = nextArg;
      index += 1;
      continue;
    }
    if (arg === "--hooks-dir") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing --hooks-dir value.");
      }
      parsed.hooksDir = nextArg;
      index += 1;
      continue;
    }
    if (arg === "--platform-mount-config") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing --platform-mount-config value.");
      }
      parsed.platformMountDirectoriesRaw = nextArg;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
};

const run = (): void => {
  const parsed = parseArgs(process.argv.slice(2));
  const report = scanSecurityMigrationState({
    securityModel: parsed.securityModel,
    hookDirectoryPath: parsed.hooksDir,
    platformMountDirectoriesRaw: parsed.platformMountDirectoriesRaw,
    includeManualChecks: parsed.includeManualChecks,
  });

  const output =
    parsed.format === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatSecurityMigrationScanReportMarkdown(report);

  if (parsed.outPath) {
    const resolvedOutPath = path.resolve(parsed.outPath);
    fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
    fs.writeFileSync(resolvedOutPath, output, "utf-8");
    console.log(`Security migration report written to: ${resolvedOutPath}`);
  }

  if (parsed.printToStdout || !parsed.outPath) {
    process.stdout.write(output);
  }

  if (parsed.assertClean && report.overview.high > 0) {
    console.error(
      `High-risk items detected (${report.overview.high}). Failing due to --assert-clean.`
    );
    process.exit(2);
  }
};

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Security migration scan failed: ${message}`);
  process.exit(1);
}
