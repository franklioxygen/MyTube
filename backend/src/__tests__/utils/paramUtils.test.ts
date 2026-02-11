import { describe, expect, it } from "vitest";
import {
  getArrayParam,
  getBooleanParam,
  getNumberParam,
  getRequiredNumberParam,
  getRequiredStringParam,
  getStringParam,
} from "../../utils/paramUtils";

describe("paramUtils", () => {
  describe("getStringParam", () => {
    it("returns default for undefined/null", () => {
      expect(getStringParam(undefined, "fallback")).toBe("fallback");
      expect(getStringParam(null as any, "fallback")).toBe("fallback");
    });

    it("handles arrays and objects", () => {
      expect(getStringParam(["first", "second"])).toBe("first");
      expect(getStringParam([] as any, "fallback")).toBe("fallback");
      expect(getStringParam({ nested: "value" } as any)).toBe("[object Object]");
    });

    it("stringifies scalar values", () => {
      expect(getStringParam("abc" as any)).toBe("abc");
      expect(getStringParam(123 as any)).toBe("123");
    });
  });

  describe("getRequiredStringParam", () => {
    it("returns value for valid strings", () => {
      expect(getRequiredStringParam("hello" as any, "q")).toBe("hello");
    });

    it("throws for missing or empty values", () => {
      expect(() => getRequiredStringParam(undefined, "q")).toThrow(
        "Missing required parameter: q"
      );
      expect(() => getRequiredStringParam("   " as any, "q")).toThrow(
        "Missing required parameter: q"
      );
    });
  });

  describe("getNumberParam", () => {
    it("returns default for undefined/null", () => {
      expect(getNumberParam(undefined, 9)).toBe(9);
      expect(getNumberParam(null as any, 9)).toBe(9);
    });

    it("handles number input", () => {
      expect(getNumberParam(42)).toBe(42);
      expect(getNumberParam(Number.NaN, 7)).toBe(7);
    });

    it("handles arrays", () => {
      expect(getNumberParam(["15"] as any)).toBe(15);
      expect(getNumberParam(["oops"] as any, 3)).toBe(3);
      expect(getNumberParam([] as any, 3)).toBe(3);
    });

    it("parses strings and object-like values", () => {
      expect(getNumberParam("101" as any)).toBe(101);
      expect(getNumberParam({ value: "123" } as any, 8)).toBe(8);
      expect(getNumberParam("abc" as any, 8)).toBe(8);
    });
  });

  describe("getRequiredNumberParam", () => {
    it("returns parsed number", () => {
      expect(getRequiredNumberParam("12" as any, "page")).toBe(12);
    });

    it("throws for missing/invalid values", () => {
      expect(() => getRequiredNumberParam(undefined, "page")).toThrow(
        "Missing or invalid required parameter: page"
      );
      expect(() => getRequiredNumberParam("bad" as any, "page")).toThrow(
        "Missing or invalid required parameter: page"
      );
    });
  });

  describe("getArrayParam", () => {
    it("returns default for undefined/null", () => {
      expect(getArrayParam(undefined, ["x"])).toEqual(["x"]);
      expect(getArrayParam(null as any, ["x"])).toEqual(["x"]);
    });

    it("returns arrays as-is and wraps scalar", () => {
      expect(getArrayParam(["a", "b"])).toEqual(["a", "b"]);
      expect(getArrayParam("solo")).toEqual(["solo"]);
    });
  });

  describe("getBooleanParam", () => {
    it("returns default for undefined/null", () => {
      expect(getBooleanParam(undefined, true)).toBe(true);
      expect(getBooleanParam(null as any, false)).toBe(false);
    });

    it("returns boolean input directly", () => {
      expect(getBooleanParam(true)).toBe(true);
      expect(getBooleanParam(false)).toBe(false);
    });

    it("handles arrays", () => {
      expect(getBooleanParam(["true"])).toBe(true);
      expect(getBooleanParam(["1"])).toBe(true);
      expect(getBooleanParam(["yes"])).toBe(true);
      expect(getBooleanParam(["false"])).toBe(false);
      expect(getBooleanParam([] as any, true)).toBe(true);
    });

    it("handles strings", () => {
      expect(getBooleanParam("true")).toBe(true);
      expect(getBooleanParam("1")).toBe(true);
      expect(getBooleanParam("yes")).toBe(true);
      expect(getBooleanParam("no")).toBe(false);
    });
  });
});
