import { describe, expect, it } from "vitest";
import { normalizeSubscriptionFilenameTemplate } from "../../../services/subscription/filenameTemplate";
import { ValidationError } from "../../../errors/DownloadErrors";

describe("normalizeSubscriptionFilenameTemplate", () => {
  it("returns null for null/undefined/empty/whitespace input", () => {
    expect(normalizeSubscriptionFilenameTemplate(null)).toBeNull();
    expect(normalizeSubscriptionFilenameTemplate(undefined)).toBeNull();
    expect(normalizeSubscriptionFilenameTemplate("")).toBeNull();
    expect(normalizeSubscriptionFilenameTemplate("   ")).toBeNull();
    expect(normalizeSubscriptionFilenameTemplate("\t\n")).toBeNull();
  });

  it("accepts a valid Liquid-style template and trims it", () => {
    expect(
      normalizeSubscriptionFilenameTemplate(
        "  {{ source_custom_name }}/{{ title }}.{{ ext }}  "
      )
    ).toBe("{{ source_custom_name }}/{{ title }}.{{ ext }}");
  });

  it("accepts a valid yt-dlp-style template", () => {
    expect(
      normalizeSubscriptionFilenameTemplate("%(title)s.%(ext)s")
    ).toBe("%(title)s.%(ext)s");
  });

  it("rejects wrong types with a ValidationError on filenameTemplate", () => {
    for (const bad of [42, {}, [], true]) {
      expect(() => normalizeSubscriptionFilenameTemplate(bad)).toThrow(
        ValidationError
      );
      try {
        normalizeSubscriptionFilenameTemplate(bad);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).field).toBe("filenameTemplate");
      }
    }
  });

  it("rejects a template with path traversal segments", () => {
    expect(() =>
      normalizeSubscriptionFilenameTemplate("../{{ title }}.{{ ext }}")
    ).toThrow(ValidationError);
  });

  it("rejects a template missing the final extension placeholder", () => {
    expect(() =>
      normalizeSubscriptionFilenameTemplate("{{ source_custom_name }}/{{ title }}")
    ).toThrow(ValidationError);
  });

  it("rejects an over-length template (2,000+ characters)", () => {
    const tooLong = "{{ title }}" + "x".repeat(2000) + ".{{ ext }}";
    expect(() => normalizeSubscriptionFilenameTemplate(tooLong)).toThrow(
      ValidationError
    );
  });

  it("attaches filenameTemplate field to validation errors", () => {
    try {
      normalizeSubscriptionFilenameTemplate("{{ title }}");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).field).toBe("filenameTemplate");
    }
  });
});
