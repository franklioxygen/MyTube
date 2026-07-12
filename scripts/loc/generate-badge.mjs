#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolvePathWithinCwd } from "../utils.mjs";

const USAGE =
  "Usage: node scripts/loc/generate-badge.mjs SCC_JSON [--output OUTPUT_PATH] [--label LABEL]";

const args = process.argv.slice(2);
let outputPath = "badges/lines-of-code.json";
let label = "lines of code";
let inputPath;

const remainingArgs = [...args];

while (remainingArgs.length > 0) {
  const arg = remainingArgs.shift();
  if (arg === "--help" || arg === "-h") {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }

  if (arg === "--output") {
    outputPath = remainingArgs.shift() ?? outputPath;
    continue;
  }

  if (arg === "--label") {
    label = remainingArgs.shift() ?? label;
    continue;
  }

  if (arg && !inputPath) {
    inputPath = arg;
  }
}

if (!inputPath) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
}

function readCodeCount(report) {
  if (Array.isArray(report)) {
    return report.reduce((total, language) => {
      const code = language?.Code;
      return total + (typeof code === "number" ? code : 0);
    }, 0);
  }

  if (Array.isArray(report?.languageSummary)) {
    return report.languageSummary.reduce((total, language) => {
      const code = language?.Code;
      return total + (typeof code === "number" ? code : 0);
    }, 0);
  }

  throw new Error("Unrecognized scc JSON format (expected array or json2 object).");
}

function formatCount(count) {
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : Number(millions.toFixed(1))}M`;
  }

  if (count >= 1_000) {
    return `${Math.round(count / 1_000)}k`;
  }

  return String(count);
}

const safeInputPath = resolvePathWithinCwd(inputPath);
// nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
const report = JSON.parse(fs.readFileSync(safeInputPath, "utf8"));
const codeCount = readCodeCount(report);

if (!Number.isFinite(codeCount) || codeCount < 0) {
  throw new Error(`Invalid code count derived from ${inputPath}`);
}

const badgePayload = {
  schemaVersion: 1,
  label,
  message: formatCount(codeCount),
  color: "blue",
  cacheSeconds: 3600,
};

const safeOutputPath = resolvePathWithinCwd(outputPath);
// nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
fs.mkdirSync(path.dirname(safeOutputPath), { recursive: true });
// nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
fs.writeFileSync(
  safeOutputPath,
  `${JSON.stringify(badgePayload, null, 2)}\n`
);

process.stdout.write(
  `${JSON.stringify(
    {
      outputPath: safeOutputPath,
      codeCount,
      message: badgePayload.message,
    },
    null,
    2
  )}\n`
);
