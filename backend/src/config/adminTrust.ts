import { logger } from "../utils/logger";
import { errorResponse } from "../utils/response";

export type AdminTrustLevel = "application" | "container" | "host";

export interface DeploymentSecurityModel {
  adminTrustLevel: AdminTrustLevel;
  adminTrustedWithContainer: boolean;
  adminTrustedWithHost: boolean;
  source: "env";
}

const DEFAULT_ADMIN_TRUST_LEVEL: AdminTrustLevel = "container";

const VALID_TRUST_LEVELS = new Set<AdminTrustLevel>([
  "application",
  "container",
  "host",
]);

function getAdminTrustRank(level: AdminTrustLevel): number {
  switch (level) {
    case "application":
      return 0;
    case "container":
      return 1;
    case "host":
      return 2;
  }
}

export function parseAdminTrustLevel(rawValue?: string): AdminTrustLevel {
  const normalized = rawValue?.trim().toLowerCase();

  if (
    normalized &&
    VALID_TRUST_LEVELS.has(normalized as AdminTrustLevel)
  ) {
    return normalized as AdminTrustLevel;
  }

  if (normalized && normalized.length > 0) {
    logger.warn(
      `[DeploymentSecurity] Invalid MYTUBE_ADMIN_TRUST_LEVEL="${rawValue}". Falling back to "${DEFAULT_ADMIN_TRUST_LEVEL}".`
    );
  }

  return DEFAULT_ADMIN_TRUST_LEVEL;
}

export function getAdminTrustLevel(): AdminTrustLevel {
  return parseAdminTrustLevel(process.env.MYTUBE_ADMIN_TRUST_LEVEL);
}

export function getDeploymentSecurityModel(): DeploymentSecurityModel {
  const adminTrustLevel = getAdminTrustLevel();
  const adminTrustRank = getAdminTrustRank(adminTrustLevel);
  return {
    adminTrustLevel,
    adminTrustedWithContainer:
      adminTrustRank >= getAdminTrustRank("container"),
    adminTrustedWithHost: adminTrustRank >= getAdminTrustRank("host"),
    source: "env",
  };
}

export function isAdminTrustLevelAtLeast(
  required: AdminTrustLevel,
  current: AdminTrustLevel = getAdminTrustLevel()
): boolean {
  return getAdminTrustRank(current) >= getAdminTrustRank(required);
}

export function createAdminTrustLevelError(required: AdminTrustLevel): {
  success: false;
  error: string;
  requiredTrustLevel: AdminTrustLevel;
} {
  const error =
    required === "host"
      ? "This feature requires host-level admin trust."
      : "This feature is disabled by deployment security policy.";

  return {
    ...errorResponse(error),
    success: false,
    requiredTrustLevel: required,
  };
}
