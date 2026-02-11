#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const [mode, sarifPath, baselinePath] = process.argv.slice(2);

const usage = () => {
  console.error('Usage: node scripts/complexity/lizard-baseline.mjs <check|update> <sarifPath> <baselinePath>');
};

if (!mode || !sarifPath || !baselinePath || !['check', 'update'].includes(mode)) {
  usage();
  process.exit(1);
}

const readJson = (targetPath) => {
  const content = fs.readFileSync(targetPath, 'utf8');
  return JSON.parse(content);
};

const normalizeText = (value) => {
  if (!value) {
    return '';
  }
  return String(value).trim().replace(/\s+/g, ' ');
};

const buildFingerprint = (result) => {
  const ruleId = normalizeText(result.ruleId || 'UNKNOWN_RULE');
  const message = normalizeText(result.message?.text || 'NO_MESSAGE');
  const location = result.locations?.[0]?.physicalLocation;
  const uri = normalizeText(location?.artifactLocation?.uri || 'UNKNOWN_FILE');
  return `${ruleId}|${uri}|${message}`;
};

const getResults = (sarif) => sarif?.runs?.[0]?.results || [];

const getRuleCounts = (results) => {
  return results.reduce((acc, result) => {
    const ruleId = normalizeText(result.ruleId || 'UNKNOWN_RULE');
    acc[ruleId] = (acc[ruleId] || 0) + 1;
    return acc;
  }, {});
};

const sortObjectKeys = (obj) => {
  return Object.keys(obj)
    .sort()
    .reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
};

const getFingerprintSet = (results) => {
  return new Set(results.map(buildFingerprint));
};

const ensureDirectory = (filePath) => {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
};

const printSummary = (label, ruleCounts, total) => {
  console.log(`${label}: ${total}`);
  Object.entries(ruleCounts).forEach(([rule, count]) => {
    console.log(`- ${rule}: ${count}`);
  });
};

const sarif = readJson(sarifPath);
const results = getResults(sarif);
const ruleCounts = sortObjectKeys(getRuleCounts(results));
const fingerprintSet = getFingerprintSet(results);
const fingerprints = Array.from(fingerprintSet).sort();

if (mode === 'update') {
  const baseline = {
    tool: 'lizard',
    createdAt: new Date().toISOString(),
    source: 'codacy-cli analyze -t lizard --format sarif',
    totalIssues: results.length,
    ruleCounts,
    fingerprints
  };

  ensureDirectory(baselinePath);
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  printSummary('Baseline updated with issues', ruleCounts, results.length);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Baseline file not found: ${baselinePath}`);
  console.error('Run: npm run complexity:baseline:update');
  process.exit(1);
}

const baseline = readJson(baselinePath);
const baselineFingerprints = new Set((baseline.fingerprints || []).map(normalizeText));
const newIssues = fingerprints.filter((fingerprint) => !baselineFingerprints.has(fingerprint));

if (newIssues.length > 0) {
  console.error(`Found ${newIssues.length} new complexity issue(s):`);
  newIssues.slice(0, 20).forEach((issue) => {
    console.error(`- ${issue}`);
  });
  if (newIssues.length > 20) {
    console.error(`...and ${newIssues.length - 20} more`);
  }
  process.exit(1);
}

printSummary('No new complexity issues detected. Current issues', ruleCounts, results.length);
