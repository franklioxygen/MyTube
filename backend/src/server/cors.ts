import { CorsOptions, CorsOptionsDelegate } from "cors";
import { Request } from "express";
import { logger } from "../utils/logger";

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "http://localhost:5556",
  "http://127.0.0.1:5556",
] as const;

function firstForwardedValue(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const value = headerValue
    .split(",")[0]
    .trim();

  return value.length > 0 ? value : null;
}

export function normalizeOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function getAllowedCorsOrigins(rawOrigins = process.env.CORS_ALLOWED_ORIGINS): string[] {
  const fromEnv = (rawOrigins || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => origin !== null);

  if (fromEnv.length > 0) {
    return Array.from(new Set(fromEnv));
  }

  return [...DEFAULT_ALLOWED_CORS_ORIGINS];
}

function resolveRequestHosts(req: Request): string[] {
  const hostCandidates = [
    firstForwardedValue(req.header("host")),
    firstForwardedValue(req.header("x-forwarded-host")),
  ].filter((host): host is string => host !== null);

  return Array.from(
    new Set(hostCandidates.map((host) => host.toLowerCase()))
  );
}

export function isOriginAllowed(
  origin: string,
  req: Request,
  allowedOrigins: ReadonlySet<string>
): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  if (allowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  const requestHosts = resolveRequestHosts(req);
  let originHost: string | null = null;
  try {
    originHost = new URL(normalizedOrigin).host.toLowerCase();
  } catch {
    originHost = null;
  }

  if (originHost && requestHosts.includes(originHost)) {
    return true;
  }

  return false;
}

export function buildCorsOptionsDelegate(
  allowedOriginsInput: string[] = getAllowedCorsOrigins()
): CorsOptionsDelegate<Request> {
  const allowedOrigins = new Set(
    allowedOriginsInput
      .map((origin) => normalizeOrigin(origin))
      .filter((origin): origin is string => origin !== null)
  );

  return (req, callback): void => {
    const requestOrigin = req.header("origin");

    const baseOptions: CorsOptions = {
      credentials: true,
    };

    if (!requestOrigin) {
      callback(null, { ...baseOptions, origin: true });
      return;
    }

    if (isOriginAllowed(requestOrigin, req, allowedOrigins)) {
      callback(null, { ...baseOptions, origin: true });
      return;
    }

    logger.warn(
      `CORS blocked origin: ${requestOrigin} (host: ${
        req.header("host") || "unknown"
      })`
    );
    // Return origin:false instead of throwing, so blocked origins do not surface as 500.
    callback(null, { ...baseOptions, origin: false });
  };
}

export { DEFAULT_ALLOWED_CORS_ORIGINS };
