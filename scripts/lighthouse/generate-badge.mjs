#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const USAGE =
  "Usage: node scripts/lighthouse/generate-badge.mjs REPORT_JSON... [--output OUTPUT_PATH] [--label LABEL]";

let outputPath = "badges/lighthouse-performance.json";
let label = "Lighthouse mobile";
const inputPaths = [];

function resolvePathWithinCwd(targetPath) {
  if (!targetPath || typeof targetPath !== "string") {
    throw new Error(`Invalid path: ${targetPath}`);
  }

  const workspaceRoot = process.cwd();
  const absolutePath = path.resolve(workspaceRoot, targetPath);
  const relativePath = path.relative(workspaceRoot, absolutePath);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Path must stay within ${workspaceRoot}: ${targetPath}`);
  }

  return absolutePath;
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--help" || arg === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  if (arg === "--output") {
    outputPath = args[index + 1] ?? outputPath;
    index += 1;
    continue;
  }

  if (arg === "--label") {
    label = args[index + 1] ?? label;
    index += 1;
    continue;
  }

  inputPaths.push(arg);
}

if (inputPaths.length === 0) {
  console.error(USAGE);
  process.exit(1);
}

const reportScores = inputPaths
  .map((inputPath) => {
    const safeInputPath = resolvePathWithinCwd(inputPath);
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const report = JSON.parse(fs.readFileSync(safeInputPath, "utf8"));
    const score = report?.categories?.performance?.score;

    if (typeof score !== "number") {
      throw new Error(`Missing performance score in ${inputPath}`);
    }

    return {
      inputPath,
      score: Math.round(score * 100),
    };
  })
  .sort((left, right) => left.score - right.score);

const medianScore = reportScores[Math.floor(reportScores.length / 2)]?.score;

if (typeof medianScore !== "number") {
  throw new Error("Failed to derive a Lighthouse performance score.");
}

const color =
  medianScore >= 90
    ? "brightgreen"
    : medianScore >= 75
      ? "yellow"
      : medianScore >= 50
        ? "orange"
        : "red";

const badgePayload = {
  schemaVersion: 1,
  label,
  message: String(medianScore),
  color,
  namedLogo: "lighthouse",
  cacheSeconds: 43200,
};

const safeOutputPath = resolvePathWithinCwd(outputPath);
// nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
// eslint-disable-next-line security/detect-non-literal-fs-filename
fs.mkdirSync(path.dirname(safeOutputPath), { recursive: true });
// nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
// eslint-disable-next-line security/detect-non-literal-fs-filename
fs.writeFileSync(
  safeOutputPath,
  `${JSON.stringify(badgePayload, null, 2)}\n`
);

console.log(
  JSON.stringify(
    {
      outputPath: safeOutputPath,
      medianScore,
      reports: reportScores,
    },
    null,
    2
  )
);
