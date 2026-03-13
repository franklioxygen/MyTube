import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordSecurityAuditEvent } from "../../services/securityAuditService";
import { logger } from "../../utils/logger";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("securityAuditService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records denied authz event with request context", () => {
    const req = {
      method: "POST",
      originalUrl: "/api/settings/private",
      path: "/api/settings/private",
      ip: "127.0.0.1",
      headers: {
        "user-agent": "vitest-agent",
      },
      user: undefined,
      apiKeyAuthenticated: false,
    } as any;

    recordSecurityAuditEvent({
      eventType: "authz.denied",
      req,
      result: "denied",
      summary: "unauthenticated write denied",
      metadata: {
        statusCode: 401,
      },
      level: "warn",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "Security audit event",
      expect.objectContaining({
        eventType: "authz.denied",
        sourceIp: "127.0.0.1",
        userAgent: "vitest-agent",
        target: "/api/settings/private",
        result: "denied",
      })
    );
  });

  it("triggers security alert when denied events burst beyond threshold", () => {
    const req = {
      method: "GET",
      originalUrl: "/api/private",
      path: "/api/private",
      ip: "10.0.0.2",
      headers: {
        "user-agent": "attack-bot",
      },
      user: undefined,
      apiKeyAuthenticated: false,
    } as any;

    for (let i = 0; i < 20; i += 1) {
      recordSecurityAuditEvent({
        eventType: "authz.denied",
        req,
        result: "denied",
        summary: "burst deny event",
        metadata: { index: i },
        level: "warn",
      });
    }

    expect(logger.warn).toHaveBeenCalledWith(
      "Security alert",
      expect.objectContaining({
        eventType: "security.alert.permission_denied_burst",
        sourceIp: "10.0.0.2",
        result: "alert",
      })
    );
  });
});
