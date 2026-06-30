/**
 * Utility functions for safely extracting and normalizing HTTP request parameters
 * Prevents type confusion attacks by ensuring parameters are the expected type
 */

import { ParsedQs } from "qs";

// Type representing what Express req.query can be
type ExpressQueryValue =
  | string
  | ParsedQs
  | (string | ParsedQs)[]
  | null
  | undefined;

const TRUTHY_BOOLEAN_VALUES = new Set(["true", "1", "yes"]);

function pickFirstValue<T>(value: T | T[]): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseIntegerValue(value: unknown): number | undefined {
  const parsed = parseInt(String(value), 10);
  return isNaN(parsed) ? undefined : parsed;
}

function parseStrictPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }

  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined || candidate === null) {
    return undefined;
  }

  const text = String(candidate).trim();
  if (!/^\d+$/.test(text)) {
    return undefined;
  }

  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isTruthyBooleanString(value: unknown): boolean {
  return TRUTHY_BOOLEAN_VALUES.has(String(value).toLowerCase());
}

/**
 * Safely extract a string parameter from request query/body/params
 * Handles string, string[], ParsedQs, and mixed arrays, taking first element if array
 */
export function getStringParam(
  value: ExpressQueryValue,
  defaultValue?: string
): string | undefined {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]) : defaultValue;
  }
  // Handle ParsedQs (object) by converting to string
  if (typeof value === "object") {
    return String(value);
  }
  return String(value);
}

/**
 * Safely extract a required string parameter from request query/body/params
 * Throws error if missing or empty
 */
export function getRequiredStringParam(
  value: ExpressQueryValue,
  paramName: string
): string {
  const result = getStringParam(value);
  if (!result || result.trim() === "") {
    throw new Error(`Missing required parameter: ${paramName}`);
  }
  return result;
}

/**
 * Safely extract a number parameter from request query/body/params
 * Handles string, string[], ParsedQs, mixed arrays, and number types, parsing to number
 */
export function getNumberParam(
  value: ExpressQueryValue | number,
  defaultValue?: number
): number | undefined {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === "number") {
    return isNaN(value) ? defaultValue : value;
  }

  const candidate = pickFirstValue(value);
  if (candidate === undefined) {
    return defaultValue;
  }

  const parsed = parseIntegerValue(candidate);
  return parsed ?? defaultValue;
}

/**
 * Extract a strictly positive integer parameter. Unlike getNumberParam(), this
 * rejects decimals, negative values, zero, and mixed strings such as "10px".
 *
 * When a `defaultValue` is supplied the result is always a `number`, so callers
 * don't need a redundant `?? default` fallback.
 */
export function getPositiveIntegerParam(
  value: ExpressQueryValue | number,
  defaultValue: number
): number;
export function getPositiveIntegerParam(
  value: ExpressQueryValue | number
): number | undefined;
export function getPositiveIntegerParam(
  value: ExpressQueryValue | number,
  defaultValue?: number
): number | undefined {
  return parseStrictPositiveInteger(value) ?? defaultValue;
}

/**
 * Clamp a numeric limit into a safe positive range.
 */
export function clampLimit(
  value: number | undefined,
  defaultValue: number,
  maxValue: number
): number {
  const candidate =
    typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
  return Math.max(1, Math.min(Math.floor(candidate), maxValue));
}

/**
 * Extract and clamp a positive integer limit parameter in one step.
 */
export function getLimitParam(
  value: ExpressQueryValue | number,
  defaultValue: number,
  maxValue: number
): number {
  return clampLimit(
    getPositiveIntegerParam(value, defaultValue),
    defaultValue,
    maxValue
  );
}

/**
 * Safely extract a required number parameter from request query/body/params
 * Throws error if missing or invalid
 */
export function getRequiredNumberParam(
  value: ExpressQueryValue | number,
  paramName: string
): number {
  const result = getNumberParam(value);
  if (result === undefined || isNaN(result)) {
    throw new Error(`Missing or invalid required parameter: ${paramName}`);
  }
  return result;
}

/**
 * Safely extract an array parameter from request query/body/params
 * Always returns an array, even if input is a single value
 */
export function getArrayParam<T = string>(
  value: string | string[] | T[] | undefined,
  defaultValue: T[] = []
): T[] {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (Array.isArray(value)) {
    return value as T[];
  }
  return [value] as T[];
}

/**
 * Safely extract a boolean parameter from request query/body/params
 * Handles string representations like "true", "false", "1", "0"
 */
export function getBooleanParam(
  value: string | string[] | boolean | undefined,
  defaultValue?: boolean
): boolean | undefined {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const candidate = pickFirstValue(value);
  if (candidate === undefined) {
    return defaultValue;
  }

  return isTruthyBooleanString(candidate);
}
