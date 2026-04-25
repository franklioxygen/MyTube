import crypto from "crypto";
import axios, { AxiosRequestConfig } from "axios";
import { buildAllowlistedHttpUrl } from "../../utils/security";
import { logger } from "../../utils/logger";
import type {
  TMDBCredentialAuthType,
  TMDBCredentialTestResult,
} from "./types";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_API_ORIGIN = "https://api.themoviedb.org";
const TMDB_REQUEST_TIMEOUT_MS = 10000;
const ALLOWED_TMDB_API_HOSTS = ["api.themoviedb.org"];
export const tmdbHttpClient = axios.create({
  baseURL: buildAllowlistedHttpUrl(TMDB_API_ORIGIN, ALLOWED_TMDB_API_HOSTS),
  timeout: TMDB_REQUEST_TIMEOUT_MS,
});

export function mapLanguageToTMDB(language?: string): string {
  switch (language) {
    case "zh":
      return "zh-CN";
    case "es":
      return "es-ES";
    case "de":
      return "de-DE";
    case "ja":
      return "ja-JP";
    case "fr":
      return "fr-FR";
    case "ko":
      return "ko-KR";
    case "ar":
      return "ar-SA";
    case "pt":
      return "pt-BR";
    case "ru":
      return "ru-RU";
    case "en":
    default:
      return "en-US";
  }
}

export class TMDBAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TMDBAuthenticationError";
  }
}

function isAllowedTMDBTokenCharacter(character: string): boolean {
  return /^[A-Za-z0-9_-]$/.test(character);
}

function stripBearerPrefix(credential: string): string {
  const trimmedCredential = credential.trim();
  const lowercaseCredential = trimmedCredential.toLowerCase();
  return lowercaseCredential.startsWith("bearer ")
    ? trimmedCredential.slice("bearer ".length).trimStart()
    : trimmedCredential;
}

function isLikelyTMDBReadAccessToken(credential: string): boolean {
  const token = stripBearerPrefix(credential);
  const tokenParts = token.split(".");
  if (tokenParts.length !== 3) {
    return false;
  }

  return tokenParts.every(
    (part) =>
      part.length >= 10 &&
      Array.from(part).every((character) =>
        isAllowedTMDBTokenCharacter(character),
      ),
  );
}

export function validateTMDBNumericId(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid TMDB id: ${id}`);
  }

  return id.toString();
}

export function buildTMDBEndpointPath(endpointPath: string): string {
  const validatedUrl = buildAllowlistedHttpUrl(
    `${TMDB_API_BASE}${endpointPath}`,
    ALLOWED_TMDB_API_HOSTS,
  );
  const parsedUrl = new URL(validatedUrl);
  return `${parsedUrl.pathname}${parsedUrl.search}`;
}

export function normalizeTMDBCredential(credential: string): string {
  return credential.trim();
}

function getTMDBCredentialAuthType(
  credential: string
): TMDBCredentialAuthType {
  const normalizedCredential = normalizeTMDBCredential(credential);
  return normalizedCredential.toLowerCase().startsWith("bearer ") ||
    isLikelyTMDBReadAccessToken(normalizedCredential)
    ? "readAccessToken"
    : "apiKey";
}

export function hashTMDBCredential(credential: string): string {
  return crypto.scryptSync(
    normalizeTMDBCredential(credential),
    "mytube:tmdb-cache-key",
    32
  ).toString("hex");
}

function requireTMDBCredential(credential: string): string {
  const normalizedCredential = normalizeTMDBCredential(credential);
  if (!normalizedCredential) {
    throw new Error("TMDB credential is required.");
  }

  return normalizedCredential;
}

export function buildTMDBRequestConfig(
  credential: string,
  params: Record<string, string> = {},
  extraConfig: AxiosRequestConfig = {}
): AxiosRequestConfig {
  const normalizedCredential = requireTMDBCredential(credential);
  const requestParams = { ...params };
  const requestHeaders: Record<string, string> = {
    ...(extraConfig.headers as Record<string, string> | undefined),
  };
  const authType = getTMDBCredentialAuthType(normalizedCredential);

  if (authType === "readAccessToken") {
    requestHeaders.Authorization = `Bearer ${stripBearerPrefix(
      normalizedCredential,
    )}`;
  } else {
    requestParams.api_key = normalizedCredential;
  }

  return {
    timeout: TMDB_REQUEST_TIMEOUT_MS,
    ...extraConfig,
    params: requestParams,
    headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
  };
}

export async function testTMDBCredential(
  credential: string
): Promise<TMDBCredentialTestResult> {
  const normalizedCredential = normalizeTMDBCredential(credential);
  if (!normalizedCredential) {
    return {
      success: false,
      authType: "apiKey",
      code: "request-failed",
      messageKey: "tmdbCredentialRequestFailed",
      error: "TMDB credential is required.",
    };
  }

  const authType = getTMDBCredentialAuthType(normalizedCredential);

  try {
    await tmdbHttpClient.get(
      buildTMDBEndpointPath("/configuration"),
      buildTMDBRequestConfig(normalizedCredential)
    );

    return {
      success: true,
      authType,
      messageKey:
        authType === "readAccessToken"
          ? "tmdbCredentialValidReadAccessToken"
          : "tmdbCredentialValidApiKey",
    };
  } catch (error) {
    const authErrorMessage = getTMDBAuthErrorMessage(error);
    if (authErrorMessage) {
      return {
        success: false,
        authType,
        code: "auth-failed",
        messageKey: "tmdbCredentialInvalid",
        error: authErrorMessage,
      };
    }

    logger.error("Error testing TMDB credential:", error);
    return {
      success: false,
      authType,
      code: "request-failed",
      messageKey: "tmdbCredentialRequestFailed",
      error: "Failed to reach TMDB. Please try again.",
    };
  }
}

function getTMDBAuthErrorMessage(error: unknown): string | null {
  const maybeAxiosError = error as
    | {
        response?: { status?: number; data?: { status_message?: string } };
        message?: string;
      }
    | undefined;

  if (maybeAxiosError?.response?.status !== 401) {
    return null;
  }

  return (
    maybeAxiosError.response.data?.status_message ||
    maybeAxiosError.message ||
    "TMDB authentication failed."
  );
}

export function throwIfTMDBAuthenticationError(error: unknown): void {
  if (error instanceof TMDBAuthenticationError) {
    throw error;
  }

  const message = getTMDBAuthErrorMessage(error);
  if (message) {
    throw new TMDBAuthenticationError(message);
  }
}
