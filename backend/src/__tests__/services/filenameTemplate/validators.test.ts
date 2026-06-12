import { describe, expect, it } from "vitest";

import { validateTemplate } from "../../../services/filenameTemplate/validators";

describe("validateTemplate", () => {
  it("rejects empty template", () => {
    const result = validateTemplate("");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Template must not be empty.");
  });

  it("rejects whitespace-only template", () => {
    const result = validateTemplate("   ");
    expect(result.valid).toBe(false);
  });

  it("rejects template missing extension placeholder", () => {
    const result = validateTemplate("{{ title }}");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("extension placeholder"))).toBe(
      true
    );
  });

  it("accepts a basic Liquid template ending with {{ ext }}", () => {
    const result = validateTemplate(
      "{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}"
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a yt-dlp-style template ending with %(ext)s", () => {
    const result = validateTemplate("%(title)s-%(channel)s.%(ext)s");
    expect(result.valid).toBe(true);
  });

  it("accepts %(ext)S as well as %(ext)s", () => {
    const result = validateTemplate("%(title)s.%(ext)S");
    expect(result.valid).toBe(true);
  });

  it("rejects unknown Liquid variable", () => {
    const result = validateTemplate("{{ unknown_var }}.{{ ext }}");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown_var"))).toBe(true);
  });

  it("rejects unknown yt-dlp placeholder", () => {
    const result = validateTemplate("%(unknown_field)s.{{ ext }}");
    expect(result.valid).toBe(false);
  });

  it("rejects unsupported yt-dlp conversion suffix", () => {
    const result = validateTemplate("%(title)q.{{ ext }}");
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Unsupported yt-dlp conversion"))
    ).toBe(true);
  });

  it("accepts duration with format expression", () => {
    const result = validateTemplate(
      "%(title)s-%(duration>%H-%M-%S)s.{{ ext }}"
    );
    expect(result.valid).toBe(true);
  });

  it("accepts nested dot-path placeholder for rawInfo lookup", () => {
    const result = validateTemplate("%(title)s-%(subtitles.en.-1.ext)s.{{ ext }}");
    expect(result.valid).toBe(true);
  });

  it("rejects '..' segments", () => {
    const result = validateTemplate("../{{ title }}.{{ ext }}");
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("'.' or '..' path segments")
      )
    ).toBe(true);
  });

  it("rejects '.' segments", () => {
    const result = validateTemplate("./{{ title }}.{{ ext }}");
    expect(result.valid).toBe(false);
  });

  it("strips leading slash and accepts the rest", () => {
    const result = validateTemplate("/{{ title }}.{{ ext }}");
    expect(result.valid).toBe(true);
  });

  it("emits warning when media_playlist_index used on non-playlist source", () => {
    const result = validateTemplate(
      "{{ media_playlist_index }} - {{ title }}.{{ ext }}",
      "channel"
    );
    expect(result.valid).toBe(true);
    expect(
      result.warnings.some((w) =>
        w.code === "media_playlist_index_unavailable" &&
        w.message.includes("media_playlist_index")
      )
    ).toBe(true);
  });

  it("does NOT emit warning for media_playlist_index on playlist source", () => {
    const result = validateTemplate(
      "{{ media_playlist_index }} - {{ title }}.{{ ext }}",
      "playlist"
    );
    expect(result.warnings).toEqual([]);
  });

  it("emits warning when source_collection_name used on single source", () => {
    const result = validateTemplate(
      "{{ source_collection_name }}/{{ title }}.{{ ext }}",
      "single"
    );
    expect(
      result.warnings.some((w) =>
        w.code === "source_collection_metadata_may_be_empty" &&
        w.message.includes("source_collection_name")
      )
    ).toBe(true);
  });

  it("static_season__episode_by_index emits playlist warning on non-playlist", () => {
    const result = validateTemplate(
      "{{ static_season__episode_by_index }} - {{ title }}.{{ ext }}",
      "channel"
    );
    expect(
      result.warnings.some((w) => w.code === "media_playlist_index_unavailable")
    ).toBe(true);
  });

  it("rejects templates over the maximum length to bound parsing cost", () => {
    const huge = "x".repeat(2001);
    const result = validateTemplate(huge);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("at most"))).toBe(true);
  });

  it("does not exhibit catastrophic backtracking on adversarial '%((' input (CodeQL js/polynomial-redos)", () => {
    // Prior regex `[^)]+` could backtrack on long unterminated `%(((((...`.
    // With `[^()]+` the regex fails fast at the first nested '(' so this
    // is linear-time. Cap the test at 200ms to detect any regression.
    const adversarial = "%(" + "(".repeat(1500);
    const start = Date.now();
    const result = validateTemplate(adversarial + ".{{ ext }}");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
    // The body of the template is invalid (no extension placeholder match),
    // so the result is invalid; what matters is that we returned quickly.
    expect(result).toBeDefined();
  });
});
