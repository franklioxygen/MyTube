/**
 * Utility functions for safely extracting and normalizing HTTP request parameters
 * Prevents type confusion attacks by ensuring parameters are the expected type
 */

import { ParsedQs } from "qs";

// Type representing what Express req.query can be
type ExpressQueryValue = string | ParsedQs | (string | ParsedQs)[] | undefined;

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
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return defaultValue;
    }
    const parsed = parseInt(String(value[0]), 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  // Handle ParsedQs (object) by converting to string first
  const stringValue = typeof value === "object" ? String(value) : String(value);
  const parsed = parseInt(stringValue, 10);
  return isNaN(parsed) ? defaultValue : parsed;
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
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return defaultValue;
    }
    const str = String(value[0]).toLowerCase();
    return str === "true" || str === "1" || str === "yes";
  }
  const str = String(value).toLowerCase();
  return str === "true" || str === "1" || str === "yes";
}
