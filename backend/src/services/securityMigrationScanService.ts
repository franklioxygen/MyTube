import fs from "fs";
import path from "path";
import { resolvePlatformMountDirectories } from "../config/mountDirectories";
import { HOOKS_DIR } from "../config/paths";
import { defaultSettings, Settings } from "../types/settings";
import { normalizeYtDlpSafeConfig } from "../utils/ytDlpSafeConfig";
import { getSettings } from "./storageService";

export type SecurityMigrationRiskLevel = "high" | "medium" | "low" | "info";

export type SecurityMigrationRiskCategory =
  | "security_model"
  | "hooks"
  | "yt_dlp"
  | "mount_directories"
  | "cloudflared"
  | "migration_state"
  | "manual_check";

export interface SecurityMigrationRiskItem {
  id: string;
  level: SecurityMigrationRiskLevel;
  category: SecurityMigrationRiskCategory;
  summary: string;
  evidence: string;
  remediation: string;
  blocking: boolean;
}

export interface SecurityMigrationScanReport {
  generatedAt: string;
  securityModel: "strict" | "legacy" | "unknown";
  strictSecurityMigrationVersion: number;
  ytDlpSafeConfigMigrationVersion: number;
  overview: {
    high: number;
    medium: number;
    low: number;
    info: number;
    readyForStrict: boolean;
  };
  items: SecurityMigrationRiskItem[];
  recommendations: string[];
}

interface SecurityMigrationScanOptions {
  settings?: Partial<Settings> | Record<string, unknown>;
  securityModel?: string | undefined;
  hookDirectoryPath?: string;
  hookFileNames?: string[];
  platformMountDirectoriesRaw?: string;
  includeManualChecks?: boolean;
}

const normalizeSecurityModel = (
  rawModel: string | undefined
): "strict" | "legacy" | "unknown" => {
  const normalized = (rawModel || "").trim().toLowerCase();
  if (normalized === "strict") {
    return "strict";
  }
  if (normalized === "legacy") {
    return "legacy";
  }
  return "unknown";
};

const countNonEmptyLines = (value: string): number =>
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0).length;

const readHookFileNames = (hookDirectoryPath: string): string[] => {
  const resolvedHooksDir = path.resolve(hookDirectoryPath);
  if (!fs.existsSync(resolvedHooksDir)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedHooksDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".sh") || name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));
};

const toMergedSettings = (
  settingsInput: Partial<Settings> | Record<string, unknown> | undefined
): Settings =>
  ({
    ...defaultSettings,
    ...(settingsInput ?? getSettings()),
  }) as Settings;

const buildRecommendations = (
  report: SecurityMigrationScanReport
): string[] => {
  const recommendations: string[] = [];
  const hasHigh = report.overview.high > 0;
  const hasMedium = report.overview.medium > 0;

  if (hasHigh) {
    recommendations.push(
      "Resolve all high-risk items first (legacy mode, shell hooks, or free-form yt-dlp text config)."
    );
  }
  if (hasMedium) {
    recommendations.push(
      "Resolve medium-risk items before strict cutover (migration version gaps, cloudflared in-app control, legacy mountDirectories state)."
    );
  }
  if (!hasHigh && !hasMedium) {
    recommendations.push(
      "No blocking migration risk detected. You can proceed with strict canary rollout."
    );
  }

  recommendations.push(
    "Archive this scan report with instance identifier, owner, and planned remediation deadline."
  );
  return recommendations;
};

export const scanSecurityMigrationState = (
  options: SecurityMigrationScanOptions = {}
): SecurityMigrationScanReport => {
  const settings = toMergedSettings(options.settings);
  const securityModel = normalizeSecurityModel(
    options.securityModel ?? process.env.SECURITY_MODEL
  );
  const hookFileNames =
    options.hookFileNames ?? readHookFileNames(options.hookDirectoryPath ?? HOOKS_DIR);
  const includeManualChecks = options.includeManualChecks !== false;

  const strictMigrationVersion =
    typeof settings.strictSecurityMigrationVersion === "number"
      ? settings.strictSecurityMigrationVersion
      : 0;
  const ytDlpMigrationVersion =
    typeof settings.ytDlpSafeConfigMigrationVersion === "number"
      ? settings.ytDlpSafeConfigMigrationVersion
      : 0;

  const riskItems: SecurityMigrationRiskItem[] = [];

  if (securityModel === "legacy") {
    riskItems.push({
      id: "security_model.legacy_enabled",
      level: "high",
      category: "security_model",
      summary: "Instance is running with SECURITY_MODEL=legacy.",
      evidence: "SECURITY_MODEL resolved to legacy.",
      remediation:
        "Prepare migration report, remediate blocking risks, and switch to SECURITY_MODEL=strict.",
      blocking: true,
    });
  } else if (securityModel === "unknown") {
    riskItems.push({
      id: "security_model.unknown",
      level: "high",
      category: "security_model",
      summary: "SECURITY_MODEL is missing or invalid for this environment.",
      evidence: "Resolved runtime value is neither strict nor legacy.",
      remediation:
        "Set SECURITY_MODEL explicitly to strict (or temporary legacy during approved migration window).",
      blocking: true,
    });
  }

  if (strictMigrationVersion < 1) {
    riskItems.push({
      id: "migration.strict_security_version_pending",
      level: "medium",
      category: "migration_state",
      summary: "strict security migration version is below target.",
      evidence: `strictSecurityMigrationVersion=${strictMigrationVersion}, target=1.`,
      remediation:
        "Start backend once in strict mode to apply migration, then rescan and verify version marker.",
      blocking: false,
    });
  }

  if (ytDlpMigrationVersion < 1) {
    riskItems.push({
      id: "migration.ytdlp_safe_config_version_pending",
      level: "medium",
      category: "migration_state",
      summary: "yt-dlp safe config migration version is below target.",
      evidence: `ytDlpSafeConfigMigrationVersion=${ytDlpMigrationVersion}, target=1.`,
      remediation:
        "Apply safe-config migration, then verify legacy ytDlpConfig is cleared and structured config is used.",
      blocking: false,
    });
  }

  const legacyShellHooks = hookFileNames.filter((name) => name.endsWith(".sh"));
  if (legacyShellHooks.length > 0) {
    riskItems.push({
      id: "hooks.legacy_shell_scripts_detected",
      level: "high",
      category: "hooks",
      summary: "Legacy shell hook scripts are present in hooks directory.",
      evidence: `Detected ${legacyShellHooks.length} script(s): ${legacyShellHooks.join(", ")}.`,
      remediation:
        "Delete .sh hook scripts and replace with declarative JSON actions if still needed.",
      blocking: true,
    });
  }

  const declarativeHooks = hookFileNames.filter((name) => name.endsWith(".json"));
  if (declarativeHooks.length > 0) {
    riskItems.push({
      id: "hooks.declarative_definitions_present",
      level: "info",
      category: "hooks",
      summary: "Declarative hook definitions are present.",
      evidence: `Detected ${declarativeHooks.length} JSON file(s): ${declarativeHooks.join(", ")}.`,
      remediation:
        "Confirm each declarative hook is required and uses approved webhook destinations.",
      blocking: false,
    });
  }

  const legacyYtDlpText =
    typeof settings.ytDlpConfig === "string" ? settings.ytDlpConfig.trim() : "";
  if (legacyYtDlpText.length > 0) {
    riskItems.push({
      id: "yt_dlp.legacy_text_config_present",
      level: "high",
      category: "yt_dlp",
      summary: "Legacy free-form yt-dlp text configuration is still present.",
      evidence: `Detected ${countNonEmptyLines(legacyYtDlpText)} non-empty legacy config line(s).`,
      remediation:
        "Migrate to ytDlpSafeConfig allowlist fields and clear legacy ytDlpConfig text.",
      blocking: true,
    });
  }

  const normalizedSafeConfig = normalizeYtDlpSafeConfig(settings.ytDlpSafeConfig, {
    rejectUnknownKeys: false,
    rejectInvalidValues: false,
  });
  if (normalizedSafeConfig.rejectedOptions.length > 0) {
    riskItems.push({
      id: "yt_dlp.invalid_safe_config_options",
      level: "medium",
      category: "yt_dlp",
      summary: "Structured yt-dlp safe config contains invalid or rejected options.",
      evidence: `Rejected option(s): ${normalizedSafeConfig.rejectedOptions.join(", ")}.`,
      remediation:
        "Remove rejected options and keep only allowlisted fields with valid values.",
      blocking: false,
    });
  }

  const legacyMountDirectories =
    typeof settings.mountDirectories === "string"
      ? settings.mountDirectories.trim()
      : "";
  if (legacyMountDirectories.length > 0) {
    riskItems.push({
      id: "mount_directories.legacy_text_present",
      level: "medium",
      category: "mount_directories",
      summary: "Legacy mountDirectories text setting is still populated.",
      evidence: `Detected ${countNonEmptyLines(legacyMountDirectories)} configured path line(s).`,
      remediation:
        "Move to PLATFORM_MOUNT_DIRECTORIES allowlist and avoid API-based host path writes.",
      blocking: false,
    });
  }

  if (settings.cloudflaredTunnelEnabled === true) {
    riskItems.push({
      id: "cloudflared.in_app_control_enabled",
      level: "medium",
      category: "cloudflared",
      summary: "In-app cloudflared control is enabled.",
      evidence: "settings.cloudflaredTunnelEnabled=true.",
      remediation:
        "Disable in-app cloudflared control and move tunnel lifecycle to platform operator controls.",
      blocking: false,
    });
  }

  const platformMountDirectories = resolvePlatformMountDirectories({
    rawConfig: options.platformMountDirectoriesRaw,
  });
  if (platformMountDirectories.length === 0) {
    riskItems.push({
      id: "mount_directories.platform_allowlist_empty",
      level: "low",
      category: "mount_directories",
      summary: "No platform mount directory allowlist is configured.",
      evidence: "PLATFORM_MOUNT_DIRECTORIES resolved to an empty set.",
      remediation:
        "If mount scanning is needed, configure PLATFORM_MOUNT_DIRECTORIES with approved directory IDs.",
      blocking: false,
    });
  }

  if (includeManualChecks) {
    riskItems.push({
      id: "manual_check.public_endpoint_dependency",
      level: "info",
      category: "manual_check",
      summary:
        "Manual validation required: no external clients depend on removed public write endpoints.",
      evidence:
        "This check cannot be inferred from runtime settings alone.",
      remediation:
        "Review client integrations and logs for deprecated endpoints before strict rollout.",
      blocking: false,
    });
  }

  const countByLevel = (level: SecurityMigrationRiskLevel): number =>
    riskItems.filter((item) => item.level === level).length;

  const report: SecurityMigrationScanReport = {
    generatedAt: new Date().toISOString(),
    securityModel,
    strictSecurityMigrationVersion: strictMigrationVersion,
    ytDlpSafeConfigMigrationVersion: ytDlpMigrationVersion,
    overview: {
      high: countByLevel("high"),
      medium: countByLevel("medium"),
      low: countByLevel("low"),
      info: countByLevel("info"),
      readyForStrict: countByLevel("high") === 0,
    },
    items: riskItems,
    recommendations: [],
  };

  report.recommendations = buildRecommendations(report);
  return report;
};

export const formatSecurityMigrationScanReportMarkdown = (
  report: SecurityMigrationScanReport
): string => {
  const lines: string[] = [];
  lines.push("# Security Migration Scan Report");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- SECURITY_MODEL: ${report.securityModel}`);
  lines.push(
    `- Migration versions: strict=${report.strictSecurityMigrationVersion}, ytDlpSafeConfig=${report.ytDlpSafeConfigMigrationVersion}`
  );
  lines.push(
    `- Risk summary: high=${report.overview.high}, medium=${report.overview.medium}, low=${report.overview.low}, info=${report.overview.info}`
  );
  lines.push(`- Ready for strict cutover: ${report.overview.readyForStrict}`);
  lines.push("");
  lines.push("## Risk Items");
  lines.push("");

  if (report.items.length === 0) {
    lines.push("- No risk item detected.");
  } else {
    for (const item of report.items) {
      lines.push(
        `- [${item.level.toUpperCase()}] ${item.id}: ${item.summary}`
      );
      lines.push(`  Evidence: ${item.evidence}`);
      lines.push(`  Remediation: ${item.remediation}`);
    }
  }

  lines.push("");
  lines.push("## Recommendations");
  lines.push("");
  for (const recommendation of report.recommendations) {
    lines.push(`- ${recommendation}`);
  }

  lines.push("");
  return lines.join("\n");
};
