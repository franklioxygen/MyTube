import { getErrorMessage } from "./apiClient";

function getBackendErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const response = (error as { response?: { data?: { error?: unknown; message?: unknown } } }).response;
  const backendMessage = response?.data?.error ?? response?.data?.message;

  return typeof backendMessage === "string" && backendMessage.trim()
    ? backendMessage
    : null;
}

export function resolveSubscriptionErrorMessage(
  error: unknown,
  source: string | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const backendMessage = getBackendErrorMessage(error);
  if (backendMessage) {
    return backendMessage;
  }

  const normalizedErrorMessage = getErrorMessage(error);
  if (
    typeof normalizedErrorMessage === "string" &&
    normalizedErrorMessage.trim() &&
    normalizedErrorMessage.toLowerCase() !== "network"
  ) {
    return normalizedErrorMessage;
  }

  return source === "twitch"
    ? t("twitchSubscriptionCredentialsMissing")
    : t("error");
}
