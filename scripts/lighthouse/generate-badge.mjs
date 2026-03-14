#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

let outputPath = "badges/lighthouse-performance.json";
let label = "Lighthouse mobile";
const inputPaths = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (arg === "--help" || arg === "-h") {
    console.log(
      "Usage: node scripts/lighthouse/generate-badge.mjs <report.json...> [--output <path>] [--label <label>]"
    );
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
  console.error(
    "Usage: node scripts/lighthouse/generate-badge.mjs <report.json...> [--output <path>] [--label <label>]"
  );
  process.exit(1);
}

const reportScores = inputPaths
  .map((inputPath) => {
    const report = JSON.parse(fs.readFileSync(inputPath, "utf8"));
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

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(badgePayload, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      outputPath,
      medianScore,
      reports: reportScores,
    },
    null,
    2
  )
);
