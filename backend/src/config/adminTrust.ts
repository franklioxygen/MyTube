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

const TRUST_LEVEL_ORDER: Record<AdminTrustLevel, number> = {
  application: 0,
  container: 1,
  host: 2,
};

const VALID_TRUST_LEVELS = new Set<AdminTrustLevel>([
  "application",
  "container",
  "host",
]);

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
  return {
    adminTrustLevel,
    adminTrustedWithContainer:
      TRUST_LEVEL_ORDER[adminTrustLevel] >= TRUST_LEVEL_ORDER.container,
    adminTrustedWithHost:
      TRUST_LEVEL_ORDER[adminTrustLevel] >= TRUST_LEVEL_ORDER.host,
    source: "env",
  };
}

export function isAdminTrustLevelAtLeast(
  required: AdminTrustLevel,
  current: AdminTrustLevel = getAdminTrustLevel()
): boolean {
  return TRUST_LEVEL_ORDER[current] >= TRUST_LEVEL_ORDER[required];
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
