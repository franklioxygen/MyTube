import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatSecurityMigrationScanReportMarkdown,
  scanSecurityMigrationState,
} from "../../services/securityMigrationScanService";

describe("securityMigrationScanService", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("detects blocking risks for legacy mode, shell hooks, and legacy yt-dlp text", () => {
    const report = scanSecurityMigrationState({
      securityModel: "legacy",
      hookFileNames: ["task_success.sh", "task_fail.json"],
      settings: {
        strictSecurityMigrationVersion: 0,
        ytDlpSafeConfigMigrationVersion: 0,
        ytDlpConfig: "--exec rm -rf /",
      },
      includeManualChecks: false,
    });

    expect(report.overview.high).toBeGreaterThanOrEqual(3);
    expect(report.items.some((item) => item.id === "security_model.legacy_enabled")).toBe(
      true
    );
    expect(
      report.items.some((item) => item.id === "hooks.legacy_shell_scripts_detected")
    ).toBe(true);
    expect(
      report.items.some((item) => item.id === "yt_dlp.legacy_text_config_present")
    ).toBe(true);
    expect(report.overview.readyForStrict).toBe(false);
  });

  it("detects medium risks for migration markers and legacy settings residue", () => {
    const report = scanSecurityMigrationState({
      securityModel: "strict",
      hookFileNames: [],
      settings: {
        strictSecurityMigrationVersion: 0,
        ytDlpSafeConfigMigrationVersion: 0,
        cloudflaredTunnelEnabled: true,
        mountDirectories: "/mnt/media\n/mnt/archive",
        ytDlpSafeConfig: {
          retries: -1,
        },
      },
      includeManualChecks: false,
    });

    expect(report.overview.high).toBe(0);
    expect(report.overview.medium).toBeGreaterThanOrEqual(4);
    expect(
      report.items.some((item) => item.id === "migration.strict_security_version_pending")
    ).toBe(true);
    expect(
      report.items.some((item) => item.id === "yt_dlp.invalid_safe_config_options")
    ).toBe(true);
    expect(
      report.items.some((item) => item.id === "mount_directories.legacy_text_present")
    ).toBe(true);
    expect(
      report.items.some((item) => item.id === "cloudflared.in_app_control_enabled")
    ).toBe(true);
  });

  it("is ready for strict when no high-risk findings remain", () => {
    const report = scanSecurityMigrationState({
      securityModel: "strict",
      hookFileNames: [],
      settings: {
        strictSecurityMigrationVersion: 1,
        ytDlpSafeConfigMigrationVersion: 1,
        ytDlpConfig: "",
        mountDirectories: "",
        cloudflaredTunnelEnabled: false,
        ytDlpSafeConfig: {
          retries: 5,
          maxResolution: 1080,
        },
      },
      includeManualChecks: false,
      platformMountDirectoriesRaw:
        '[{"id":"library","label":"Library","path":"/mnt/library"}]',
    });

    expect(report.overview.high).toBe(0);
    expect(report.overview.medium).toBe(0);
    expect(report.overview.readyForStrict).toBe(true);
  });

  it("reads hook files from provided hooks directory when hookFileNames is not provided", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-hooks-"));
    tempDirs.push(tempDir);
    // nosemgrep -- tempDir is a test-controlled directory created in this test
    fs.writeFileSync(path.join(tempDir, "task_success.sh"), "#!/bin/sh\necho hi");
    // nosemgrep -- tempDir is a test-controlled directory created in this test
    fs.writeFileSync(
      path.join(tempDir, "task_success.json"),
      JSON.stringify({ version: 1, actions: [] })
    );

    const report = scanSecurityMigrationState({
      securityModel: "strict",
      hookDirectoryPath: tempDir,
      settings: {
        strictSecurityMigrationVersion: 1,
        ytDlpSafeConfigMigrationVersion: 1,
      },
      includeManualChecks: false,
    });

    expect(
      report.items.some((item) => item.id === "hooks.legacy_shell_scripts_detected")
    ).toBe(true);
    expect(
      report.items.some((item) => item.id === "hooks.declarative_definitions_present")
    ).toBe(true);
  });

  it("formats markdown output with summary and recommendation sections", () => {
    const report = scanSecurityMigrationState({
      securityModel: "strict",
      hookFileNames: [],
      settings: {
        strictSecurityMigrationVersion: 1,
        ytDlpSafeConfigMigrationVersion: 1,
      },
      includeManualChecks: true,
    });

    const markdown = formatSecurityMigrationScanReportMarkdown(report);
    expect(markdown).toContain("# Security Migration Scan Report");
    expect(markdown).toContain("## Risk Items");
    expect(markdown).toContain("## Recommendations");
  });
});
