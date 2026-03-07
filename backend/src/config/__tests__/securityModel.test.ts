import { describe, expect, it } from "vitest";
import {
  assertSecurityModelConfiguration,
  DEFAULT_SECURITY_MODEL,
  isStrictSecurityModel,
  resolveSecurityModel,
} from "../securityModel";

describe("securityModel config", () => {
  it("uses legacy default when SECURITY_MODEL is not provided in non-production", () => {
    const model = resolveSecurityModel({
      nodeEnv: "development",
      rawSecurityModel: undefined,
    });

    expect(model).toBe(DEFAULT_SECURITY_MODEL);
  });

  it("parses strict and legacy values case-insensitively", () => {
    const strictModel = resolveSecurityModel({
      rawSecurityModel: "  STRICT ",
      nodeEnv: "development",
    });
    const legacyModel = resolveSecurityModel({
      rawSecurityModel: "legacy",
      nodeEnv: "development",
    });

    expect(strictModel).toBe("strict");
    expect(legacyModel).toBe("legacy");
  });

  it("falls back to default model for invalid value outside production", () => {
    const model = resolveSecurityModel({
      nodeEnv: "test",
      rawSecurityModel: "invalid",
    });

    expect(model).toBe(DEFAULT_SECURITY_MODEL);
  });

  it("throws in production when SECURITY_MODEL is missing", () => {
    expect(() =>
      assertSecurityModelConfiguration({
        nodeEnv: "production",
        rawSecurityModel: undefined,
      })
    ).toThrow(/SECURITY_MODEL is missing/i);
  });

  it("throws in production when SECURITY_MODEL is invalid", () => {
    expect(() =>
      assertSecurityModelConfiguration({
        nodeEnv: "production",
        rawSecurityModel: "permissive",
      })
    ).toThrow(/SECURITY_MODEL is invalid value/i);
  });

  it("accepts strict in production", () => {
    const model = assertSecurityModelConfiguration({
      nodeEnv: "production",
      rawSecurityModel: "strict",
    });

    expect(model).toBe("strict");
    expect(
      isStrictSecurityModel({
        nodeEnv: "production",
        rawSecurityModel: "strict",
      })
    ).toBe(true);
  });
});
