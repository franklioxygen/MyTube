import { afterEach, describe, expect, it } from "vitest";
import {
  getDeploymentSecurityModel,
  parseAdminTrustLevel,
} from "../adminTrust";

describe("adminTrust config", () => {
  const originalTrustLevel = process.env.MYTUBE_ADMIN_TRUST_LEVEL;

  afterEach(() => {
    if (originalTrustLevel === undefined) {
      delete process.env.MYTUBE_ADMIN_TRUST_LEVEL;
    } else {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = originalTrustLevel;
    }
  });

  it("parses valid trust levels", () => {
    expect(parseAdminTrustLevel("application")).toBe("application");
    expect(parseAdminTrustLevel("container")).toBe("container");
    expect(parseAdminTrustLevel("host")).toBe("host");
  });

  it("falls back to container for invalid values", () => {
    expect(parseAdminTrustLevel("nope")).toBe("container");
    expect(parseAdminTrustLevel("")).toBe("container");
    expect(parseAdminTrustLevel(undefined)).toBe("container");
  });

  it("builds deployment security metadata from env", () => {
    process.env.MYTUBE_ADMIN_TRUST_LEVEL = "host";

    expect(getDeploymentSecurityModel()).toEqual({
      adminTrustLevel: "host",
      adminTrustedWithContainer: true,
      adminTrustedWithHost: true,
      source: "env",
    });
  });
});
