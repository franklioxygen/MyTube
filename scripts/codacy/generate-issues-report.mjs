#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { resolvePathWithinCwd } from "../utils.mjs";

const CATEGORY_LABELS = new Map([
  ["BestPractice", "Best practice"],
  ["CodeStyle", "Code style"],
  ["Compatibility", "Compatibility"],
  ["ErrorProne", "Error prone"],
  ["Performance", "Performance"],
  ["Security", "Security"],
  ["UnusedCode", "Unused code"],
]);
const CATEGORY_ORDER = [
  "Security",
  "ErrorProne",
  "Performance",
  "Compatibility",
  "BestPractice",
  "CodeStyle",
  "UnusedCode",
];
const SEVERITY_ORDER = [
  "Critical",
  "High",
  "Error",
  "Medium",
  "Warning",
  "Low",
  "Info",
];
const USAGE =
  "Usage: CODACY_API_TOKEN=... node scripts/codacy/generate-issues-report.mjs [--provider PROVIDER] [--owner OWNER] [--repo REPO] [--out OUTPUT_PATH] [--full-details]";

function usageAndExit(message) {
  if (message) {
    console.error(`Error: ${message}`);
  }
  console.error(USAGE);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    provider: "gh",
    owner: undefined,
    repo: undefined,
    out: "reports/codacy-current-issues.md",
    fullDetails: false,
  };
  let pendingOption = null;

  for (const arg of argv) {
    if (pendingOption === "--provider") {
      args.provider = arg;
      pendingOption = null;
      continue;
    }
    if (pendingOption === "--owner") {
      args.owner = arg;
      pendingOption = null;
      continue;
    }
    if (pendingOption === "--repo") {
      args.repo = arg;
      pendingOption = null;
      continue;
    }
    if (pendingOption === "--out") {
      args.out = arg;
      pendingOption = null;
      continue;
    }

    if (arg === "--provider") {
      pendingOption = arg;
      continue;
    }
    if (arg === "--owner") {
      pendingOption = arg;
      continue;
    }
    if (arg === "--repo") {
      pendingOption = arg;
      continue;
    }
    if (arg === "--out") {
      pendingOption = arg;
      continue;
    }
    if (arg === "--full-details") {
      args.fullDetails = true;
      continue;
    }
    usageAndExit(`Unknown argument: ${arg}`);
  }

  if (pendingOption) {
    usageAndExit(`Missing value for ${pendingOption}`);
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
  return CATEGORY_LABELS.get(raw) || raw || "Unknown";
}

function inlineCode(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value ? `\`${value.replaceAll("`", "\\`")}\`` : "_(none)_";
}

function normalizeText(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value || "n/a";
}

function sortIssues(issues) {
  const categoryRank = new Map(CATEGORY_ORDER.map((value, index) => [value, index]));
  const severityRank = new Map(SEVERITY_ORDER.map((value, index) => [value, index]));

  return [...issues].sort((left, right) => {
    const leftCategory = left?.patternInfo?.category || "Unknown";
    const rightCategory = right?.patternInfo?.category || "Unknown";
    const leftCategoryRank = categoryRank.get(leftCategory) ?? CATEGORY_ORDER.length;
    const rightCategoryRank = categoryRank.get(rightCategory) ?? CATEGORY_ORDER.length;
    if (leftCategoryRank !== rightCategoryRank) {
      return leftCategoryRank - rightCategoryRank;
    }

    const leftSeverity = left?.patternInfo?.severityLevel || "Unknown";
    const rightSeverity = right?.patternInfo?.severityLevel || "Unknown";
    const leftSeverityRank = severityRank.get(leftSeverity) ?? SEVERITY_ORDER.length;
    const rightSeverityRank = severityRank.get(rightSeverity) ?? SEVERITY_ORDER.length;
    if (leftSeverityRank !== rightSeverityRank) {
      return leftSeverityRank - rightSeverityRank;
    }

    const leftFile = left?.filePath || "";
    const rightFile = right?.filePath || "";
    const fileCompare = leftFile.localeCompare(rightFile);
    if (fileCompare !== 0) {
      return fileCompare;
    }

    const leftLine = Number(left?.lineNumber || 0);
    const rightLine = Number(right?.lineNumber || 0);
    if (leftLine !== rightLine) {
      return leftLine - rightLine;
    }

    const leftRule = left?.patternInfo?.id || "";
    const rightRule = right?.patternInfo?.id || "";
    const ruleCompare = leftRule.localeCompare(rightRule);
    if (ruleCompare !== 0) {
      return ruleCompare;
    }

    return String(left?.issueId || "").localeCompare(String(right?.issueId || ""));
  });
}

function formatIssue(issue, index) {
  const category = categoryLabel(issue?.patternInfo?.category);
  const severity = issue?.patternInfo?.severityLevel || issue?.patternInfo?.level || "Unknown";
  const subCategory = issue?.patternInfo?.subCategory || "n/a";
  const toolName = issue?.toolInfo?.name || "Unknown";
  const toolUuid = issue?.toolInfo?.uuid || "";
  const filePath = issue?.filePath || "unknown";
  const lineNumber = issue?.lineNumber || "?";
  const commitSha = issue?.commitInfo?.sha || "n/a";
  const commitName = issue?.commitInfo?.commiterName || "n/a";
  const commitEmail = issue?.commitInfo?.commiter || "n/a";
  const commitTimestamp = issue?.commitInfo?.timestamp || "n/a";
  const falsePositiveThreshold =
    issue?.falsePositiveThreshold === undefined ? "n/a" : String(issue.falsePositiveThreshold);

  return [
    `### ${index}. ${inlineCode(`${filePath}:${lineNumber}`)}`,
    "",
    `- Category: ${category}`,
    `- Severity: ${severity}`,
    `- Rule: ${inlineCode(issue?.patternInfo?.id || "Unknown")}`,
    `- Subcategory: ${inlineCode(subCategory)}`,
    `- Tool: ${inlineCode(toolName)}${toolUuid ? ` (${inlineCode(toolUuid)})` : ""}`,
    `- Language: ${inlineCode(issue?.language || "Unknown")}`,
    `- Message: ${normalizeText(issue?.message)}`,
    `- Source line: ${inlineCode(issue?.lineText || "")}`,
    `- Codacy IDs: issue ${inlineCode(issue?.issueId || "n/a")}, result data ${inlineCode(issue?.resultDataId || "n/a")}, file ${inlineCode(issue?.fileId || "n/a")}`,
    `- False positive threshold: ${falsePositiveThreshold}`,
    `- Commit: ${inlineCode(commitSha)} by ${inlineCode(commitName)} (${inlineCode(commitEmail)}) at ${inlineCode(commitTimestamp)}`,
  ].join("\n");
}

function buildFullDetailsSections(issues) {
  const grouped = new Map();
  const sortedIssues = sortIssues(issues);

  for (const issue of sortedIssues) {
    const category = issue?.patternInfo?.category || "Unknown";
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category).push(issue);
  }

  return [...grouped.entries()]
    .map(([category, categoryIssues]) => {
      const issueSections = categoryIssues
        .map((issue, index) => formatIssue(issue, index + 1))
        .join("\n\n");

      return [
        `## ${categoryLabel(category)} Issues (${categoryIssues.length})`,
        "",
        issueSections,
      ].join("\n");
    })
    .join("\n\n");
}

function buildMarkdown({
  provider,
  owner,
  repo,
  issues,
  totalFromApi,
  generatedAt,
  fullDetails,
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
  const fullIssueSections = fullDetails
    ? [
        "## Full Issue Details",
        "",
        buildFullDetailsSections(issues),
      ].join("\n")
    : "";

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
    ...(fullIssueSections ? ["", fullIssueSections] : []),
    "",
  ].join("\n");
}

async function main() {
  const { provider, owner: cliOwner, repo: cliRepo, out, fullDetails } = parseArgs(
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
    fullDetails,
  });

  const outputPath = resolvePathWithinCwd(out);
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.writeFile(outputPath, markdown, "utf8");

  console.log(`Report written: ${outputPath}`);
  console.log(`Fetched issues: ${allIssues.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
