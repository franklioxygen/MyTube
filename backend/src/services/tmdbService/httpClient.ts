import axios from "axios";
import { buildAllowlistedHttpUrl } from "../../utils/security";
import {
  ALLOWED_TMDB_API_HOSTS,
  TMDB_API_BASE,
  TMDB_API_ORIGIN,
  TMDB_REQUEST_TIMEOUT_MS,
} from "./constants";

export const tmdbHttpClient = axios.create({
  baseURL: buildAllowlistedHttpUrl(TMDB_API_ORIGIN, ALLOWED_TMDB_API_HOSTS),
  timeout: TMDB_REQUEST_TIMEOUT_MS,
});

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
