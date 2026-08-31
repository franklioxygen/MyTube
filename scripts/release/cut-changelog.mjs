import fs from "node:fs";
import process from "node:process";

import { resolvePathWithinCwd } from "../utils.mjs";

// Turns the CHANGELOG's "## Unreleased" section into "## vX.Y.Z (YYYY-MM-DD)"
// and opens a fresh empty "## Unreleased" above it. Run from the repo root as
// part of scripts/release/release.sh, once the new version is known.

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: node scripts/release/cut-changelog.mjs <version>");
  process.exit(1);
}

const changelogPath = resolvePathWithinCwd("CHANGELOG.md");
const original = fs.readFileSync(changelogPath, "utf8");
const lines = original.split("\n");

const heading = `## v${version} (`;
if (lines.some((line) => line.startsWith(heading))) {
  console.log(`ℹ️  CHANGELOG already has a v${version} section; leaving it alone.`);
  process.exit(0);
}

const unreleasedAt = lines.indexOf("## Unreleased");
if (unreleasedAt === -1) {
  console.error("❌ CHANGELOG.md has no '## Unreleased' heading to cut.");
  process.exit(1);
}

const nextSectionAt = lines.findIndex(
  (line, index) => index > unreleasedAt && line.startsWith("## ")
);
const sectionEnd = nextSectionAt === -1 ? lines.length : nextSectionAt;
const body = lines.slice(unreleasedAt + 1, sectionEnd);

if (!body.some((line) => line.startsWith("- "))) {
  console.log("⚠️  Unreleased section is empty; releasing without a CHANGELOG section.");
  process.exit(0);
}

const date = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
lines.splice(unreleasedAt, 1, "## Unreleased", "", `## v${version} (${date})`);

fs.writeFileSync(changelogPath, lines.join("\n"));
console.log(`✅ CHANGELOG: cut Unreleased into v${version} (${date}).`);
