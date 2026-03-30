export const TWITCH_CHANNEL_TAB_SEGMENTS = [
  "videos",
  "about",
  "schedule",
  "clips",
] as const;

export const TWITCH_RESERVED_ROOT_SEGMENTS = [
  "directory",
  "downloads",
  "settings",
  "jobs",
  "p",
  "videos",
  "login",
  "signup",
  "subscriptions",
  "inventory",
  "drops",
  "search",
  "turbo",
] as const;

const TWITCH_LOGIN_REGEX = /^[A-Za-z0-9][A-Za-z0-9_]*$/;
const TWITCH_CLIENT_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{7,}$/;
const TWITCH_CLIENT_SECRET_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{11,}$/;
const TWITCH_CHANNEL_HOSTNAMES = [
  "twitch.tv",
  "www.twitch.tv",
  "m.twitch.tv",
] as const;

export type TwitchCredentialValidationCode =
  | "missing_client_id"
  | "missing_client_secret"
  | "invalid_client_id"
  | "invalid_client_secret";

function parseTwitchUrl(url: string): URL | null {
  try {
    const parsedUrl = new URL(url);
    if (
      (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.port
    ) {
      return null;
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      !TWITCH_CHANNEL_HOSTNAMES.includes(
        hostname as (typeof TWITCH_CHANNEL_HOSTNAMES)[number]
      )
    ) {
      return null;
    }

    return parsedUrl;
  } catch {
    return null;
  }
}

export function extractTwitchChannelLogin(url: string): string | null {
  const parsedUrl = parseTwitchUrl(url);
  if (!parsedUrl) {
    return null;
  }

  const segments = parsedUrl.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const firstSegment = segments[0]?.toLowerCase();
  if (
    !firstSegment ||
    TWITCH_RESERVED_ROOT_SEGMENTS.includes(
      firstSegment as (typeof TWITCH_RESERVED_ROOT_SEGMENTS)[number]
    )
  ) {
    return null;
  }

  if (!TWITCH_LOGIN_REGEX.test(segments[0] || "")) {
    return null;
  }

  if (segments.length === 1) {
    return firstSegment;
  }

  const secondSegment = segments[1]?.toLowerCase();
  if (
    segments.length === 2 &&
    secondSegment &&
    TWITCH_CHANNEL_TAB_SEGMENTS.includes(
      secondSegment as (typeof TWITCH_CHANNEL_TAB_SEGMENTS)[number]
    )
  ) {
    return firstSegment;
  }

  return null;
}

export function isTwitchChannelUrl(url: string): boolean {
  return extractTwitchChannelLogin(url) !== null;
}

export function normalizeTwitchChannelUrl(url: string): string {
  const login = extractTwitchChannelLogin(url);
  return login ? `https://www.twitch.tv/${login}` : url;
}

export function normalizeTwitchChannelUrlOrNull(url: string): string | null {
  const login = extractTwitchChannelLogin(url);
  return login ? `https://www.twitch.tv/${login}` : null;
}

export function normalizeTwitchCredential(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidTwitchClientId(value: string): boolean {
  return TWITCH_CLIENT_ID_REGEX.test(value);
}

export function isValidTwitchClientSecret(value: string): boolean {
  return TWITCH_CLIENT_SECRET_REGEX.test(value);
}

export function getTwitchCredentialValidationCode(
  clientIdRaw: string | undefined,
  clientSecretRaw: string | undefined
): TwitchCredentialValidationCode | null {
  const clientId = normalizeTwitchCredential(clientIdRaw);
  const clientSecret = normalizeTwitchCredential(clientSecretRaw);

  if (!clientId && !clientSecret) {
    return null;
  }

  if (!clientId) {
    return "missing_client_id";
  }

  if (!clientSecret) {
    return "missing_client_secret";
  }

  if (!isValidTwitchClientId(clientId)) {
    return "invalid_client_id";
  }

  if (!isValidTwitchClientSecret(clientSecret)) {
    return "invalid_client_secret";
  }

  return null;
}
