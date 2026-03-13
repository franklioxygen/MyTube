import http, { OutgoingHttpHeaders } from "http";
import https from "https";

export interface NotifyWebhookHookAction {
  type: "notify_webhook";
  url: string;
  method: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  bodyTemplate?: string;
  timeoutMs?: number;
}

export type HookWebhookExecutionContext = {
  eventName: string;
} & Record<string, string | undefined>;

const FORBIDDEN_WEBHOOK_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
]);
const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;
const MIN_WEBHOOK_TIMEOUT_MS = 500;
const MAX_WEBHOOK_TIMEOUT_MS = 20_000;
const MAX_BODY_TEMPLATE_LENGTH = 4096;

const sanitizeHeaders = (rawHeaders: unknown): Record<string, string> => {
  if (!rawHeaders || typeof rawHeaders !== "object") {
    throw new Error("notify_webhook.headers must be an object");
  }

  const sanitizedHeaders: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(
    rawHeaders as Record<string, unknown>
  )) {
    const key = rawKey.trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) {
      throw new Error(`Invalid webhook header name: ${rawKey}`);
    }
    if (typeof rawValue !== "string") {
      throw new Error(`Webhook header value for ${rawKey} must be a string`);
    }
    if (FORBIDDEN_WEBHOOK_HEADER_NAMES.has(key.toLowerCase())) {
      throw new Error(`Forbidden webhook header: ${rawKey}`);
    }
    sanitizedHeaders[key] = rawValue.trim();
  }

  return sanitizedHeaders;
};

export const parseNotifyWebhookAction = (
  rawAction: unknown
): NotifyWebhookHookAction => {
  if (!rawAction || typeof rawAction !== "object") {
    throw new Error("Hook action must be an object");
  }

  const action = rawAction as Record<string, unknown>;
  if (action.type !== "notify_webhook") {
    throw new Error("Unsupported hook action type");
  }

  const urlValue = typeof action.url === "string" ? action.url.trim() : "";
  if (!urlValue) {
    throw new Error("notify_webhook.url is required");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    throw new Error("notify_webhook.url is not a valid URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("notify_webhook.url protocol must be http or https");
  }

  const methodRaw =
    typeof action.method === "string" ? action.method.toUpperCase() : "POST";
  if (!["POST", "PUT", "PATCH"].includes(methodRaw)) {
    throw new Error("notify_webhook.method must be POST, PUT, or PATCH");
  }

  let timeoutMs: number | undefined;
  if (action.timeoutMs !== undefined) {
    if (
      typeof action.timeoutMs !== "number" ||
      !Number.isFinite(action.timeoutMs)
    ) {
      throw new Error("notify_webhook.timeoutMs must be a number");
    }
    timeoutMs = Math.trunc(action.timeoutMs);
    if (timeoutMs < MIN_WEBHOOK_TIMEOUT_MS || timeoutMs > MAX_WEBHOOK_TIMEOUT_MS) {
      throw new Error(
        `notify_webhook.timeoutMs must be between ${MIN_WEBHOOK_TIMEOUT_MS} and ${MAX_WEBHOOK_TIMEOUT_MS}`
      );
    }
  }

  let headers: Record<string, string> | undefined;
  if (action.headers !== undefined) {
    headers = sanitizeHeaders(action.headers);
  }

  let bodyTemplate: string | undefined;
  if (action.bodyTemplate !== undefined) {
    if (typeof action.bodyTemplate !== "string") {
      throw new Error("notify_webhook.bodyTemplate must be a string");
    }
    bodyTemplate = action.bodyTemplate;
    if (bodyTemplate.length > MAX_BODY_TEMPLATE_LENGTH) {
      throw new Error("notify_webhook.bodyTemplate is too long");
    }
  }

  return {
    type: "notify_webhook",
    url: parsedUrl.toString(),
    method: methodRaw as NotifyWebhookHookAction["method"],
    headers,
    bodyTemplate,
    timeoutMs,
  };
};

const renderTemplate = (
  template: string,
  context: HookWebhookExecutionContext
): string => {
  const valueMap: Record<string, string> = {
    eventName: context.eventName,
    taskId: context.taskId ?? "",
    taskTitle: context.taskTitle ?? "",
    sourceUrl: context.sourceUrl ?? "",
    status: context.status ?? "",
    videoPath: context.videoPath ?? "",
    thumbnailPath: context.thumbnailPath ?? "",
    error: context.error ?? "",
  };

  return template.replace(TEMPLATE_TOKEN_PATTERN, (_full, token: string) => {
    return valueMap[token] ?? "";
  });
};

export const executeNotifyWebhookAction = async (
  context: HookWebhookExecutionContext,
  action: NotifyWebhookHookAction
): Promise<void> => {
  const targetUrl = new URL(action.url);
  const transport = targetUrl.protocol === "https:" ? https : http;
  const timeoutMs = action.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  const payload =
    typeof action.bodyTemplate === "string"
      ? renderTemplate(action.bodyTemplate, context)
      : JSON.stringify({
          eventName: context.eventName,
          taskId: context.taskId,
          taskTitle: context.taskTitle,
          sourceUrl: context.sourceUrl,
          status: context.status,
          videoPath: context.videoPath,
          thumbnailPath: context.thumbnailPath,
          error: context.error,
          emittedAt: new Date().toISOString(),
        });

  const headers: OutgoingHttpHeaders = { ...(action.headers || {}) };
  if (!headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] =
      typeof action.bodyTemplate === "string"
        ? "text/plain; charset=utf-8"
        : "application/json; charset=utf-8";
  }
  headers["Content-Length"] = Buffer.byteLength(payload).toString();

  await new Promise<void>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: action.method,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        });
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf-8").trim();
          const statusCode = response.statusCode || 0;
          if (statusCode >= 400) {
            reject(
              new Error(
                `Webhook request failed (${statusCode})${responseBody ? `: ${responseBody}` : ""}`
              )
            );
            return;
          }
          resolve();
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Webhook request timed out after ${timeoutMs}ms`));
    });
    request.write(payload);
    request.end();
  });
};
