import { Request } from "express";

const getHeaderValue = (req: Request, key: string): string | undefined => {
  const headerValue =
    typeof req.get === "function"
      ? req.get(key)
      : req.headers?.[key.toLowerCase()];

  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return typeof headerValue === "string" ? headerValue : undefined;
};

const isSecureLocalHostname = (hostname: string): boolean => {
  const normalizedHostname = hostname
    .replace(/^\[(.*)\]$/, "$1")
    .toLowerCase();

  const isIpv4LoopbackLiteral = /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname);

  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "::1" ||
    isIpv4LoopbackLiteral ||
    normalizedHostname.endsWith(".localhost")
  );
};

const hasEncryptedSocket = (req: Request): boolean => {
  const socket = req.socket as { encrypted?: unknown } | undefined;
  return socket?.encrypted === true;
};

const hasMatchingCsrfToken = (req: Request): boolean => {
  const csrfCookie = req.cookies?.mytube_csrf;
  const csrfHeader = getHeaderValue(req, "x-csrf-token");

  return (
    typeof csrfCookie === "string" &&
    csrfCookie.length > 0 &&
    csrfCookie === csrfHeader
  );
};

const getRequestUrlFromHeaders = (req: Request): URL | null => {
  const rawUrl = getHeaderValue(req, "origin") || getHeaderValue(req, "referer");

  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};

const isSecureBrowserOriginRequest = (req: Request): boolean => {
  if (!hasMatchingCsrfToken(req)) {
    return false;
  }

  const requestUrl = getRequestUrlFromHeaders(req);
  if (!requestUrl) {
    return false;
  }

  return (
    requestUrl.protocol === "https:" ||
    isSecureLocalHostname(requestUrl.hostname)
  );
};

export const isSecurePasskeySettingsRequest = (req: Request): boolean => {
  if (hasEncryptedSocket(req)) {
    return true;
  }

  return isSecureBrowserOriginRequest(req);
};
