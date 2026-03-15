import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
}));

const alertWindowRows = new Map<
  string,
  { timestampsJson: string; lastAlertAt: number; updatedAt: number }
>();

const installModuleMocks = (): void => {
  mocks.prepare.mockImplementation((sql: string) => {
    if (
      sql.includes("CREATE TABLE IF NOT EXISTS security_audit_logs") ||
      sql.includes("CREATE TABLE IF NOT EXISTS security_alert_windows") ||
      sql.includes("CREATE INDEX IF NOT EXISTS")
    ) {
      return { run: vi.fn(() => ({})) };
    }

    if (
      sql.includes("DELETE FROM security_audit_logs") ||
      sql.includes("DELETE FROM security_alert_windows")
    ) {
      return { run: vi.fn(() => ({ changes: 0 })) };
    }

    if (sql.includes("INSERT INTO security_audit_logs")) {
      return { run: vi.fn(() => ({})) };
    }

    if (sql.includes("FROM security_alert_windows")) {
      return {
        get: vi.fn((windowKey: string) => {
          const row = alertWindowRows.get(windowKey);
          return row
            ? {
                timestampsJson: row.timestampsJson,
                lastAlertAt: row.lastAlertAt,
              }
            : undefined;
        }),
      };
    }

    if (sql.includes("INSERT OR REPLACE INTO security_alert_windows")) {
      return {
        run: vi.fn(
          (
            windowKey: string,
            timestampsJson: string,
            lastAlertAt: number,
            updatedAt: number
          ) => {
            alertWindowRows.set(windowKey, {
              timestampsJson,
              lastAlertAt,
              updatedAt,
            });
            return {};
          }
        ),
      };
    }

    return {
      run: vi.fn(() => ({})),
      get: vi.fn(),
      all: vi.fn(() => []),
    };
  });

  vi.doMock("../../db", () => ({
    sqlite: {
      prepare: mocks.prepare,
    },
  }));

  vi.doMock("../../utils/logger", () => ({
    logger: {
      info: mocks.loggerInfo,
      warn: mocks.loggerWarn,
      error: mocks.loggerError,
      debug: mocks.loggerDebug,
    },
  }));
};

describe("securityAuditService persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    alertWindowRows.clear();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reloads persisted alert windows after module reset", async () => {
    const baseTimestamp = 1_772_856_000_000;

    installModuleMocks();
    const firstModule = await import("../../services/securityAuditService");

    for (let index = 0; index < 4; index += 1) {
      firstModule.recordSecurityAuditEvent({
        eventType: "config.dangerous_rejected",
        actor: "admin:1",
        sourceIp: "203.0.113.10",
        userAgent: "vitest-agent",
        target: "/api/settings",
        result: "rejected",
        summary: "dangerous config rejected",
        timestamp: baseTimestamp + index,
        level: "warn",
      });
    }

    expect(alertWindowRows.has("dangerous_config_rejected_burst:203.0.113.10")).toBe(
      true
    );
    expect(
      JSON.parse(
        alertWindowRows.get("dangerous_config_rejected_burst:203.0.113.10")!
          .timestampsJson
      )
    ).toHaveLength(4);
    expect(mocks.loggerWarn).not.toHaveBeenCalledWith(
      "Security alert",
      expect.anything()
    );

    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "false");

    installModuleMocks();
    const secondModule = await import("../../services/securityAuditService");
    secondModule.recordSecurityAuditEvent({
      eventType: "config.dangerous_rejected",
      actor: "admin:1",
      sourceIp: "203.0.113.10",
      userAgent: "vitest-agent",
      target: "/api/settings",
      result: "rejected",
      summary: "dangerous config rejected",
      timestamp: baseTimestamp + 4,
      level: "warn",
    });

    expect(
      JSON.parse(
        alertWindowRows.get("dangerous_config_rejected_burst:203.0.113.10")!
          .timestampsJson
      )
    ).toHaveLength(5);

    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "Security alert",
      expect.objectContaining({
        eventType: "security.alert.dangerous_config_rejected_burst",
        sourceIp: "203.0.113.10",
        result: "alert",
      })
    );
  });
});
