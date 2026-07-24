import {
  DownloadFilenameMode,
  DownloadFilenamePresetId,
  LEGACY_DOWNLOAD_FILENAME_TEMPLATE,
} from "../../types/settings";
import {
  DEPRECATED_PRESET_ID_TO_CURRENT_PRESET_ID,
  DEPRECATED_TEMPLATE_ALIASES,
  resolvePresetById,
  FILENAME_TEMPLATE_PRESETS,
} from "./presets";
import { validateTemplate } from "./validators";

export type MatchedPresetId = string;

export interface ResolvedFilenameNamingConfig {
  mode: DownloadFilenameMode;
  template: string | null;
  matchedPresetId: MatchedPresetId;
}

export interface FilenameNamingRuntimeConfig {
  mode: DownloadFilenameMode;
  template: string | null;
}

const DEPRECATED_CUSTOM_PRESET_ID = "custom";
const VALID_DEPRECATED_PRESET_IDS = new Set<string>([
  ...FILENAME_TEMPLATE_PRESETS.map((preset) => preset.id),
  ...Object.keys(DEPRECATED_PRESET_ID_TO_CURRENT_PRESET_ID),
  DEPRECATED_CUSTOM_PRESET_ID,
]);

type FilenameNamingSelectionInput = {
  downloadFilenameMode?: unknown;
  downloadFilenamePresetId?: unknown;
  downloadFilenameTemplate?: unknown;
};

type FilenameNamingValidationResult = {
  resolved: ResolvedFilenameNamingConfig;
  errors: Array<{ field: string; message: string }>;
};

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export function isDownloadFilenameMode(
  value: unknown
): value is DownloadFilenameMode {
  return value === "legacy" || value === "template";
}

export function isDeprecatedDownloadFilenamePresetId(
  value: unknown
): value is DownloadFilenamePresetId {
  return typeof value === "string" && VALID_DEPRECATED_PRESET_IDS.has(value);
}

export function resolveTemplateFromPresetId(id: unknown): string | null {
  if (id === "legacy") {
    return LEGACY_DOWNLOAD_FILENAME_TEMPLATE;
  }

  if (typeof id !== "string" || id === DEPRECATED_CUSTOM_PRESET_ID) {
    return null;
  }

  return resolvePresetById(id)?.template ?? null;
}

export function matchPresetIdFromTemplate(
  template: string | null,
  mode: DownloadFilenameMode
): MatchedPresetId {
  if (mode === "legacy") {
    return "legacy";
  }

  if (!template) {
    return DEPRECATED_CUSTOM_PRESET_ID;
  }

  for (const preset of FILENAME_TEMPLATE_PRESETS) {
    if (preset.id === "legacy") {
      continue;
    }
    if (preset.template === template) {
      return preset.id;
    }
  }

  const deprecatedAlias = DEPRECATED_TEMPLATE_ALIASES[template];
  if (
    deprecatedAlias &&
    (!deprecatedAlias.onlyWhenMode || deprecatedAlias.onlyWhenMode === mode)
  ) {
    return deprecatedAlias.matchedPresetId;
  }

  return DEPRECATED_CUSTOM_PRESET_ID;
}

export function resolveFilenameNamingConfig(
  input: FilenameNamingSelectionInput
): ResolvedFilenameNamingConfig {
  if (
    hasOwn(input, "downloadFilenameMode") &&
    isDownloadFilenameMode(input.downloadFilenameMode)
  ) {
    if (input.downloadFilenameMode === "legacy") {
      return {
        mode: "legacy",
        template: null,
        matchedPresetId: "legacy",
      };
    }

    const templateFromInput =
      typeof input.downloadFilenameTemplate === "string"
        ? input.downloadFilenameTemplate
        : null;
    const templateFromDeprecatedPreset =
      typeof input.downloadFilenamePresetId === "string" &&
      input.downloadFilenamePresetId !== "legacy" &&
      input.downloadFilenamePresetId !== DEPRECATED_CUSTOM_PRESET_ID
        ? resolveTemplateFromPresetId(input.downloadFilenamePresetId)
        : null;
    const template = templateFromInput ?? templateFromDeprecatedPreset;

    return {
      mode: "template",
      template,
      matchedPresetId: matchPresetIdFromTemplate(template, "template"),
    };
  }

  if (
    hasOwn(input, "downloadFilenamePresetId") &&
    typeof input.downloadFilenamePresetId === "string"
  ) {
    if (input.downloadFilenamePresetId === "legacy") {
      return {
        mode: "legacy",
        template: null,
        matchedPresetId: "legacy",
      };
    }

    if (input.downloadFilenamePresetId === DEPRECATED_CUSTOM_PRESET_ID) {
      const template =
        typeof input.downloadFilenameTemplate === "string"
          ? input.downloadFilenameTemplate
          : null;

      return {
        mode: "template",
        template,
        matchedPresetId: matchPresetIdFromTemplate(template, "template"),
      };
    }

    const template = resolveTemplateFromPresetId(input.downloadFilenamePresetId);
    if (template !== null) {
      return {
        mode: "template",
        template,
        matchedPresetId: String(input.downloadFilenamePresetId),
      };
    }
  }

  return {
    mode: "legacy",
    template: null,
    matchedPresetId: "legacy",
  };
}

export function isLegacyFilenameNaming(
  input: FilenameNamingSelectionInput
): boolean {
  return resolveFilenameNamingConfig(input).mode === "legacy";
}

export function validateFilenameNamingSelection(
  input: FilenameNamingSelectionInput
): FilenameNamingValidationResult {
  const errors: Array<{ field: string; message: string }> = [];

  if (
    hasOwn(input, "downloadFilenameMode") &&
    input.downloadFilenameMode !== undefined &&
    !isDownloadFilenameMode(input.downloadFilenameMode)
  ) {
    errors.push({
      field: "downloadFilenameMode",
      message: `Invalid downloadFilenameMode: "${String(
        input.downloadFilenameMode
      )}".`,
    });
  }

  if (
    hasOwn(input, "downloadFilenamePresetId") &&
    input.downloadFilenamePresetId !== undefined &&
    !isDeprecatedDownloadFilenamePresetId(input.downloadFilenamePresetId)
  ) {
    errors.push({
      field: "downloadFilenamePresetId",
      message: `Invalid downloadFilenamePresetId: "${String(
        input.downloadFilenamePresetId
      )}".`,
    });
  }

  if (
    hasOwn(input, "downloadFilenameTemplate") &&
    input.downloadFilenameTemplate !== undefined &&
    typeof input.downloadFilenameTemplate !== "string"
  ) {
    errors.push({
      field: "downloadFilenameTemplate",
      message: "Filename template must be a string.",
    });
  }

  const resolved = resolveFilenameNamingConfig(input);

  if (errors.length > 0) {
    return { resolved, errors };
  }

  if (resolved.mode !== "template") {
    return { resolved, errors };
  }

  if (!resolved.template || resolved.template.trim().length === 0) {
    errors.push({
      field: "downloadFilenameTemplate",
      message: "Filename template is required when template mode is enabled.",
    });
    return { resolved, errors };
  }

  const validation = validateTemplate(resolved.template);
  if (!validation.valid) {
    errors.push({
      field: "downloadFilenameTemplate",
      message: `Invalid filename template: ${validation.errors.join("; ")}`,
    });
  }

  return { resolved, errors };
}

export function normalizeFilenameNamingSettings<T extends FilenameNamingSelectionInput>(
  existingSettings: FilenameNamingSelectionInput,
  incomingSettings: T
): Omit<T, "downloadFilenamePresetId"> & {
  downloadFilenameMode: DownloadFilenameMode;
  downloadFilenameTemplate?: string;
} {
  const touchesFilenameNaming =
    hasOwn(incomingSettings, "downloadFilenameMode") ||
    hasOwn(incomingSettings, "downloadFilenamePresetId") ||
    hasOwn(incomingSettings, "downloadFilenameTemplate");

  if (!touchesFilenameNaming) {
    return { ...incomingSettings } as Omit<T, "downloadFilenamePresetId"> & {
      downloadFilenameMode: DownloadFilenameMode;
      downloadFilenameTemplate?: string;
    };
  }

  const existingResolved = resolveFilenameNamingConfig(existingSettings);
  const resolverInput: FilenameNamingSelectionInput = {};

  if (hasOwn(incomingSettings, "downloadFilenameMode")) {
    resolverInput.downloadFilenameMode = incomingSettings.downloadFilenameMode;

    if (hasOwn(incomingSettings, "downloadFilenameTemplate")) {
      resolverInput.downloadFilenameTemplate =
        incomingSettings.downloadFilenameTemplate;
    } else if (existingResolved.template !== null) {
      resolverInput.downloadFilenameTemplate = existingResolved.template;
    }

    if (hasOwn(incomingSettings, "downloadFilenamePresetId")) {
      resolverInput.downloadFilenamePresetId =
        incomingSettings.downloadFilenamePresetId;
    }
  } else if (hasOwn(incomingSettings, "downloadFilenamePresetId")) {
    resolverInput.downloadFilenamePresetId =
      incomingSettings.downloadFilenamePresetId;

    if (hasOwn(incomingSettings, "downloadFilenameTemplate")) {
      resolverInput.downloadFilenameTemplate =
        incomingSettings.downloadFilenameTemplate;
    } else if (existingResolved.template !== null) {
      resolverInput.downloadFilenameTemplate = existingResolved.template;
    }
  } else if (hasOwn(incomingSettings, "downloadFilenameTemplate")) {
    resolverInput.downloadFilenameMode = "template";
    resolverInput.downloadFilenameTemplate =
      incomingSettings.downloadFilenameTemplate;
  }

  const resolved = resolveFilenameNamingConfig(resolverInput);
  const normalized = {
    ...incomingSettings,
    downloadFilenameMode: resolved.mode,
  } as Omit<T, "downloadFilenamePresetId"> & {
    downloadFilenameMode: DownloadFilenameMode;
    downloadFilenameTemplate?: string;
  };

  if (resolved.mode === "template" && resolved.template !== null) {
    normalized.downloadFilenameTemplate = resolved.template;
  } else if (!hasOwn(incomingSettings, "downloadFilenameTemplate")) {
    delete normalized.downloadFilenameTemplate;
  }

  delete (normalized as { downloadFilenamePresetId?: unknown })
    .downloadFilenamePresetId;
  return normalized;
}

export function toFilenameNamingRuntimeConfig(
  input: FilenameNamingSelectionInput
): FilenameNamingRuntimeConfig {
  const resolved = resolveFilenameNamingConfig(input);
  return {
    mode: resolved.mode,
    template: resolved.template,
  };
}

/**
 * Settings shape that carries the global filename naming fields. The override
 * helper only reads/writes the three naming fields, so any settings object with
 * those fields (plus arbitrary others) is accepted.
 */
type FilenameSettingsLike = {
  downloadFilenameMode?: unknown;
  downloadFilenamePresetId?: unknown;
  downloadFilenameTemplate?: unknown;
  [key: string]: unknown;
};

/**
 * Overlay a per-subscription filename-template override onto the global naming
 * settings, producing one coherent effective settings object for the download
 * pipeline (issue #368).
 *
 * When `subscriptionTemplate` is null/undefined/blank, the original
 * `globalSettings` object is returned unchanged — preserving object identity
 * and current behavior for every non-subscription path.
 *
 * When set, the helper returns a new object that forces template naming with
 * the subscription's template. All three runtime naming fields are set together
 * so the various path-planning branches (legacy-vs-template early branch,
 * `planVideoOutputPaths`, author-collection movement, and Bilibili subtitle
 * logic) cannot disagree:
 *   - `downloadFilenameMode: "template"`
 *   - `downloadFilenamePresetId`: a derived preset id (or "custom") so existing
 *     `presetId !== "legacy"` branches still flip to template mode
 *   - `downloadFilenameTemplate`: the subscription template
 */
export function applySubscriptionFilenameTemplateOverride<
  T extends FilenameSettingsLike
>(
  globalSettings: T,
  subscriptionTemplate?: string | null
): T {
  const normalizedTemplate = subscriptionTemplate?.trim();
  if (!normalizedTemplate) {
    return globalSettings;
  }

  return {
    ...globalSettings,
    downloadFilenameMode: "template",
    downloadFilenamePresetId: matchPresetIdFromTemplate(
      normalizedTemplate,
      "template"
    ),
    downloadFilenameTemplate: normalizedTemplate,
  } as T;
}
