import { Request } from "express";
import crypto from "crypto";
import * as storageService from "../services/storageService";
import { defaultSettings } from "../types/settings";

export const readHeaderValue = (
  value: string | string[] | undefined
): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0];
  }
  return undefined;
};

export const getApiKeyFromRequest = (req: Request): string | null => {
  const directHeaderKey = readHeaderValue(req.headers["x-api-key"]);
  if (typeof directHeaderKey === "string" && directHeaderKey.trim().length > 0) {
    return directHeaderKey.trim();
  }

  const authorizationHeader = readHeaderValue(req.headers.authorization);
  if (
    typeof authorizationHeader === "string" &&
    authorizationHeader.startsWith("ApiKey ")
  ) {
    const apiKey = authorizationHeader.slice("ApiKey ".length).trim();
    return apiKey.length > 0 ? apiKey : null;
  }

  return null;
};

const isApiKeyMatch = (providedApiKey: string, storedApiKey: string): boolean => {
  // Compare API keys in constant time without using a password-hash primitive.
  // Buffers are zero-padded to equal length so timingSafeEqual can be used safely.
  const providedBuffer = Buffer.from(providedApiKey, "utf8");
  const storedBuffer = Buffer.from(storedApiKey, "utf8");
  const maxLength = Math.max(providedBuffer.length, storedBuffer.length);

  const paddedProvided = Buffer.alloc(maxLength);
  const paddedStored = Buffer.alloc(maxLength);
  providedBuffer.copy(paddedProvided);
  storedBuffer.copy(paddedStored);

  const sameLength = providedBuffer.length === storedBuffer.length;
  const equal = crypto.timingSafeEqual(paddedProvided, paddedStored);

  return sameLength && equal;
};

export const isApiKeyAuthorized = (req: Request): boolean => {
  const providedApiKey = getApiKeyFromRequest(req);
  if (!providedApiKey) {
    return false;
  }

  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };
  if (mergedSettings.apiKeyEnabled !== true) {
    return false;
  }

  const storedApiKey =
    typeof mergedSettings.apiKey === "string"
      ? mergedSettings.apiKey.trim()
      : "";
  if (storedApiKey.length === 0) {
    return false;
  }

  return isApiKeyMatch(providedApiKey, storedApiKey);
};
