import { Response } from "express";
import {
  AdminTrustLevel,
  createAdminTrustLevelError,
  isAdminTrustLevelAtLeast,
} from "../../config/adminTrust";
import { Settings } from "../../types/settings";

const TRUST_GATED_SETTINGS_REQUIREMENTS: Partial<
  Record<keyof Settings, AdminTrustLevel>
> = {
  ytDlpConfig: "container",
  proxyOnlyYoutube: "container",
  mountDirectories: "host",
};

const areSettingValuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  if (
    typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null
  ) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
};

const normalizeTrustGatedSettingValue = (
  key: keyof Settings,
  value: unknown
): unknown => {
  if ((key === "ytDlpConfig" || key === "mountDirectories") && value == null) {
    return "";
  }

  if (key === "proxyOnlyYoutube" && value == null) {
    return false;
  }

  return value;
};

export const enforceTrustLevelForSettingsChanges = (
  res: Response,
  existingSettings: Settings,
  incomingSettings: Partial<Settings>
): Partial<Settings> | null => {
  const sanitizedSettings = { ...incomingSettings };

  for (const [rawKey, requiredTrustLevel] of Object.entries(
    TRUST_GATED_SETTINGS_REQUIREMENTS
  )) {
    const key = rawKey as keyof Settings;

    if (
      requiredTrustLevel === undefined ||
      !Object.prototype.hasOwnProperty.call(sanitizedSettings, key)
    ) {
      continue;
    }

    if (isAdminTrustLevelAtLeast(requiredTrustLevel)) {
      continue;
    }

    const nextValue = normalizeTrustGatedSettingValue(
      key,
      sanitizedSettings[key]
    );
    const currentValue = normalizeTrustGatedSettingValue(
      key,
      existingSettings[key]
    );

    if (areSettingValuesEqual(currentValue, nextValue)) {
      delete sanitizedSettings[key];
      continue;
    }

    res.status(403).json(createAdminTrustLevelError(requiredTrustLevel));
    return null;
  }

  return sanitizedSettings;
};
