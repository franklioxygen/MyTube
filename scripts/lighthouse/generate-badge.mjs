#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const usage =
  "Usage: node scripts/lighthouse/generate-badge.mjs REPORT_JSON... [--output OUTPUT_PATH] [--label LABEL]";
const args = [...process.argv.slice(2)];

let outputPath = "badges/lighthouse-performance.json";
let label = "Lighthouse mobile";
const inputPaths = [];
const workspaceRoot = path.resolve(process.cwd());

const isPathInsideDir = (candidatePath, allowedDir) => {
  const relativePath = path.relative(allowedDir, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
};

const assertPathInsideWorkspace = (candidatePath, labelForError) => {
  if (!isPathInsideDir(candidatePath, workspaceRoot)) {
    throw new Error(`${labelForError} path must stay within ${workspaceRoot}`);
  }
};

const resolveWorkspacePath = (rawPath, labelForError) => {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new Error(`Missing ${labelForError} path`);
  }
  if (rawPath.includes("\0")) {
    throw new Error(`Invalid ${labelForError} path`);
  }

  const resolvedPath = path.resolve(workspaceRoot, rawPath);
  assertPathInsideWorkspace(resolvedPath, labelForError);
  return resolvedPath;
};

while (args.length > 0) {
  const arg = args.shift();

  if (arg === "--help" || arg === "-h") {
    console.log(usage);
    process.exit(0);
  }

  if (arg === "--output") {
    outputPath = args.shift() ?? outputPath;
    continue;
  }

  if (arg === "--label") {
    label = args.shift() ?? label;
    continue;
  }

  inputPaths.push(arg);
}

if (inputPaths.length === 0) {
  console.error(usage);
  process.exit(1);
}

const reportScores = inputPaths
  .map((inputPath) => {
    const resolvedInputPath = resolveWorkspacePath(inputPath, "input");
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const report = JSON.parse(fs.readFileSync(resolvedInputPath, "utf8"));
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

const resolvedOutputPath = resolveWorkspacePath(outputPath, "output");
const resolvedOutputDir = path.dirname(resolvedOutputPath);
assertPathInsideWorkspace(resolvedOutputDir, "output directory");
// eslint-disable-next-line security/detect-non-literal-fs-filename
fs.mkdirSync(resolvedOutputDir, { recursive: true });
// eslint-disable-next-line security/detect-non-literal-fs-filename
fs.writeFileSync(resolvedOutputPath, `${JSON.stringify(badgePayload, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      outputPath: resolvedOutputPath,
      medianScore,
      reports: reportScores,
    },
    null,
    2
  )
);
