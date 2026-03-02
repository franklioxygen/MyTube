#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CATEGORY_LABELS = {
  BestPractice: "Best practice",
  CodeStyle: "Code style",
  Compatibility: "Compatibility",
  ErrorProne: "Error prone",
  Performance: "Performance",
  Security: "Security",
  UnusedCode: "Unused code",
};

function usageAndExit(message) {
  if (message) {
    console.error(`Error: ${message}`);
  }
  console.error(
    "Usage: CODACY_API_TOKEN=... node scripts/codacy/generate-issues-report.mjs [--provider gh] [--owner <owner>] [--repo <repo>] [--out <path>]",
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    provider: "gh",
    owner: undefined,
    repo: undefined,
    out: "reports/codacy-current-issues.md",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--provider") {
      args.provider = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--owner") {
      args.owner = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--repo") {
      args.repo = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out") {
      args.out = argv[i + 1];
      i += 1;
      continue;
    }
    usageAndExit(`Unknown argument: ${arg}`);
  }

  return args;
}

function safeRemoteUrl() {
  try {
    return execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function parseOwnerRepoFromRemote(remoteUrl) {
  if (!remoteUrl) {
    return {};
  }
  const cleaned = remoteUrl
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");

  const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) {
    return {};
  }
  return { owner: match[1], repo: match[2] };
}

async function fetchPage({ token, provider, owner, repo, cursor }) {
  const base = `https://app.codacy.com/api/v3/analysis/organizations/${encodeURIComponent(provider)}/${encodeURIComponent(owner)}/repositories/${encodeURIComponent(repo)}/issues/search`;
  const url = new URL(base);
  url.searchParams.set("limit", "100");
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "api-token": token,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = payload?.message || payload?.error || response.statusText;
    throw new Error(`Codacy API request failed (${response.status}): ${details}`);
  }

  return payload;
}

function countBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item) || "Unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function topEntries(map, limit = 20) {
  return [...map.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit);
}

function mdTable(headers, rows) {
  const headerLine = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, separator, ...rowLines].join("\n");
}

function escapePipes(text) {
  return String(text).replaceAll("|", "\\|");
}

function categoryLabel(raw) {
  return CATEGORY_LABELS[raw] || raw || "Unknown";
}

function buildMarkdown({
  provider,
  owner,
  repo,
  issues,
  totalFromApi,
  generatedAt,
}) {
  const byCategory = countBy(issues, (issue) => issue?.patternInfo?.category);
  const bySeverity = countBy(issues, (issue) => issue?.patternInfo?.severityLevel);
  const byLanguage = countBy(issues, (issue) => issue?.language);
  const byRule = countBy(issues, (issue) => issue?.patternInfo?.id);
  const byFile = countBy(issues, (issue) => issue?.filePath);

  const categoryRows = topEntries(byCategory, 99).map(([category, count]) => [
    categoryLabel(category),
    String(count),
  ]);
  const severityRows = topEntries(bySeverity, 99).map(([severity, count]) => [
    escapePipes(severity),
    String(count),
  ]);
  const topRuleRows = topEntries(byRule, 30).map(([rule, count]) => [
    `\`${escapePipes(rule)}\``,
    String(count),
  ]);
  const topFileRows = topEntries(byFile, 30).map(([file, count]) => [
    `\`${escapePipes(file)}\``,
    String(count),
  ]);
  const languageRows = topEntries(byLanguage, 20).map(([language, count]) => [
    escapePipes(language),
    String(count),
  ]);

  const detailsSections = topEntries(byCategory, 99)
    .map(([category]) => {
      const inCategory = issues.filter(
        (issue) => (issue?.patternInfo?.category || "Unknown") === category,
      );
      const rules = topEntries(countBy(inCategory, (issue) => issue?.patternInfo?.id), 10);
      const files = topEntries(countBy(inCategory, (issue) => issue?.filePath), 10);
      const samples = inCategory.slice(0, 8);

      const ruleList = rules.map(([rule, count]) => `- \`${rule}\`: ${count}`).join("\n");
      const fileList = files.map(([file, count]) => `- \`${file}\`: ${count}`).join("\n");
      const sampleList = samples
        .map((issue) => {
          const filePath = issue?.filePath || "unknown";
          const line = issue?.lineNumber || "?";
          const rule = issue?.patternInfo?.id || "unknown-rule";
          const msg = issue?.message || "";
          return `- \`${filePath}:${line}\` [\`${rule}\`] ${msg}`;
        })
        .join("\n");

      return [
        `## ${categoryLabel(category)} (${inCategory.length})`,
        "",
        "Top rules:",
        ruleList || "- (none)",
        "",
        "Top files:",
        fileList || "- (none)",
        "",
        "Sample issues:",
        sampleList || "- (none)",
      ].join("\n");
    })
    .join("\n\n");

  return [
    "# Codacy Current Issues Report",
    "",
    `- Generated at: ${generatedAt}`,
    `- Repository: \`${provider}/${owner}/${repo}\``,
    `- Total issues (API): ${totalFromApi}`,
    `- Total issues (fetched): ${issues.length}`,
    "",
    "## Category summary",
    "",
    mdTable(["Category", "Total"], categoryRows),
    "",
    "## Severity summary",
    "",
    mdTable(["Severity", "Total"], severityRows),
    "",
    "## Language summary",
    "",
    mdTable(["Language", "Total"], languageRows),
    "",
    "## Top 30 rules",
    "",
    mdTable(["Rule", "Total"], topRuleRows),
    "",
    "## Top 30 files",
    "",
    mdTable(["File", "Total"], topFileRows),
    "",
    detailsSections,
    "",
  ].join("\n");
}

async function main() {
  const { provider, owner: cliOwner, repo: cliRepo, out } = parseArgs(
    process.argv.slice(2),
  );
  const token = process.env.CODACY_API_TOKEN;
  if (!token) {
    usageAndExit("CODACY_API_TOKEN is required");
  }

  const parsed = parseOwnerRepoFromRemote(safeRemoteUrl());
  const owner = cliOwner || parsed.owner;
  const repo = cliRepo || parsed.repo;
  if (!owner || !repo) {
    usageAndExit("Unable to detect owner/repo. Pass --owner and --repo.");
  }

  const allIssues = [];
  let cursor;
  let totalFromApi = 0;
  do {
    const page = await fetchPage({ token, provider, owner, repo, cursor });
    const pageIssues = Array.isArray(page?.data) ? page.data : [];
    allIssues.push(...pageIssues);

    totalFromApi = Number(page?.pagination?.total || totalFromApi || 0);
    cursor = page?.pagination?.cursor;
  } while (cursor);

  const markdown = buildMarkdown({
    provider,
    owner,
    repo,
    issues: allIssues,
    totalFromApi,
    generatedAt: new Date().toISOString(),
  });

  const outputPath = path.resolve(process.cwd(), out);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, "utf8");

  console.log(`Report written: ${outputPath}`);
  console.log(`Fetched issues: ${allIssues.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
