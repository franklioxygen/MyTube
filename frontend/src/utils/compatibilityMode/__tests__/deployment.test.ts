import { afterEach, describe, expect, it, vi } from "vitest";
import { isCompatibilityModeForced } from "../deployment";

const setFlag = (value: unknown) => {
  vi.stubEnv("VITE_FORCE_COMPATIBILITY_MODE", value as string);
};

describe("isCompatibilityModeForced", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off by default, so ordinary browsers keep the opt-in toggle", () => {
    expect(isCompatibilityModeForced()).toBe(false);
  });

  it("accepts the usual truthy spellings a build environment produces", () => {
    for (const value of ["true", "TRUE", " true ", "1", "yes", "on"]) {
      setFlag(value);
      expect(isCompatibilityModeForced()).toBe(true);
    }
  });

  it("treats anything else as not forced", () => {
    for (const value of ["false", "0", "", "no", undefined]) {
      setFlag(value);
      expect(isCompatibilityModeForced()).toBe(false);
    }
  });
});
