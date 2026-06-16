import { TemplateWarning } from "./types";
import { KNOWN_FILENAME_TEMPLATE_LIQUID_KEYS } from "./reference";

const KNOWN_LIQUID_VARS = new Set(KNOWN_FILENAME_TEMPLATE_LIQUID_KEYS);

const FORBIDDEN_LIQUID_VARS = new Set(["__proto__", "constructor", "prototype"]);

const KNOWN_YTDLP_VARS = new Set([
  "title",
  "id",
  "channel",
  "uploader",
  "upload_date",
  "ext",
]);

const SUPPORTED_CONVERSIONS = new Set(["s", "S", "d"]);

const EXT_PLACEHOLDER_RE = /\.({{[ \t]*ext[ \t]*}}|%\(ext\)[sS])$/;

// Defense in depth: even with a linear-time regex, cap the template length
// so the validator and renderer cannot be flooded with megabyte-sized input.
const MAX_TEMPLATE_LENGTH = 2000;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: TemplateWarning[];
}

/**
 * Validates a filename template for correctness.
 * Returns errors that must be fixed and warnings that are informational.
 */
export function validateTemplate(
  template: string,
  sourceCollectionType?: "channel" | "playlist" | "single" | "unknown"
): ValidationResult {
  const errors: string[] = [];
  const warnings: TemplateWarning[] = [];

  if (!template || template.trim().length === 0) {
    errors.push("Template must not be empty.");
    return { valid: false, errors, warnings };
  }

  if (template.length > MAX_TEMPLATE_LENGTH) {
    errors.push(`Template must be at most ${MAX_TEMPLATE_LENGTH} characters.`);
    return { valid: false, errors, warnings };
  }

  // Normalize for validation
  let normalized = template.trim().replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }

  // Must be relative after normalization
  if (normalized.startsWith("/")) {
    errors.push("Template must produce a relative path.");
  }

  // Reject .. segments
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === ".." || seg === ".") {
      errors.push("Template must not contain '.' or '..' path segments.");
      break;
    }
  }

  // Final path segment must end with extension placeholder
  if (!EXT_PLACEHOLDER_RE.test(normalized)) {
    errors.push(
      "Template must end with an extension placeholder: .{{ ext }}, .%(ext)s, or .%(ext)S"
    );
  }

  // Validate Liquid-style variables
  const liquidRe = /\{\{[ \t]*([a-zA-Z0-9_]+)[ \t]*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = liquidRe.exec(normalized)) !== null) {
    const varName = m[1];
    if (FORBIDDEN_LIQUID_VARS.has(varName)) {
      errors.push(`Forbidden template variable: {{ ${varName} }}`);
      continue;
    }

    if (!KNOWN_LIQUID_VARS.has(varName) && !/^[a-zA-Z0-9_]+$/.test(varName)) {
      errors.push(`Unknown template variable: {{ ${varName} }}`);
    }
  }

  // Validate yt-dlp-style placeholders  %(<expr>)<conv>
  // [^()]+ (not [^)]+) prevents ReDoS on adversarial input like "%(((((..."
  // (CodeQL js/polynomial-redos). yt-dlp placeholders never nest, so
  // disallowing "(" inside the inner group is also semantically correct.
  const ytdlpRe = /%\(([^()]+)\)([a-zA-Z])/g;
  while ((m = ytdlpRe.exec(normalized)) !== null) {
    const expr = m[1];
    const conv = m[2];

    if (!SUPPORTED_CONVERSIONS.has(conv)) {
      errors.push(`Unsupported yt-dlp conversion '${conv}' in %(${expr})${conv}.`);
      continue;
    }

    const gtIndex = expr.indexOf(">");
    const varPart = gtIndex >= 0 ? expr.slice(0, gtIndex) : expr;

    // Nested dot-path lookups (e.g. subtitles.en.-1.ext) are allowed from rawInfo
    if (varPart.includes(".")) {
      // nested lookup - OK
      continue;
    }

    if (!KNOWN_YTDLP_VARS.has(varPart) && varPart !== "duration") {
      errors.push(`Unknown yt-dlp placeholder: %(${expr})${conv}`);
    }
  }

  // Source-type specific warnings
  if (
    sourceCollectionType !== "playlist" &&
    (normalized.includes("media_playlist_index") ||
      normalized.includes("static_season__episode_by_index"))
  ) {
    warnings.push({
      code: "media_playlist_index_unavailable",
      message:
        "media_playlist_index is unavailable for non-playlist sources and will fall back to 00.",
    });
  }

  if (
    sourceCollectionType === "single" &&
    (normalized.includes("source_collection_name") ||
      normalized.includes("source_collection_id"))
  ) {
    warnings.push({
      code: "source_collection_metadata_may_be_empty",
      message:
        "source_collection_name/id may be empty for single-video downloads.",
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}
