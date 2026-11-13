import type { AxiosResponse } from "axios";
import type { Request, Response } from "express";
import type { Readable } from "stream";
import { publicAxiosGet } from "../../utils/publicAxios";
import { logger } from "../../utils/logger";
import { validateRedirectUrl } from "../../utils/security";
import { getConfig, isConfigured } from "../cloudStorage/config";
import { CloudStorageService } from "../CloudStorageService";

/**
 * Streams cloud (OpenList) assets to federation consumers (design §7).
 *
 * The signed URL is resolved and refreshed here and never leaves this
 * instance. Requests go through the guarded public client: the configured
 * storage origin is trusted, and every redirect hop must be that origin or a
 * public address. Only Range and conditional headers go upstream, and only
 * content and validator headers come back.
 */

export const CLOUD_PREFIX = "cloud:";
export type CloudFileType = "video" | "audio" | "thumbnail";

export const CLOUD_FIRST_BYTE_TIMEOUT_MS = 10_000;
export const CLOUD_IDLE_TIMEOUT_MS = 60_000;

const FORWARDED_REQUEST_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since"];
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];
const PASSED_THROUGH_STATUSES = new Set([200, 206, 304, 412, 416]);

/** The configured storage origin, or null when cloud storage is off. */
export function getCloudStorageOrigin(): string | null {
  try {
    const config = getConfig();
    if (!isConfigured(config)) return null;
    return new URL(config.publicUrl || config.apiUrl.replace("/api/fs/put", "")).origin;
  } catch {
    return null;
  }
}

export type CloudProxyFailure = "unavailable" | "upstream_error" | "upstream_timeout";

async function resolveSignedUrl(
  filename: string,
  fileType: CloudFileType
): Promise<{ url: string; origin: string } | null> {
  const origin = getCloudStorageOrigin();
  if (!origin || !filename) return null;
  const signed = await CloudStorageService.getSignedUrl(filename, fileType);
  if (!signed) return null;
  try {
    const url = validateRedirectUrl(signed, origin);
    return new URL(url).origin === origin ? { url, origin } : null;
  } catch {
    logger.warn("[Federation] Cloud signed URL is outside the storage origin");
    return null;
  }
}

/**
 * Proxy one cloud asset. Calls `fail` instead of responding when nothing has
 * been sent yet; after streaming starts, a failure ends the response.
 */
export async function proxyCloudAsset(
  req: Request,
  res: Response,
  filename: string,
  fileType: CloudFileType,
  fail: (reason: CloudProxyFailure) => void,
  {
    firstByteTimeoutMs = CLOUD_FIRST_BYTE_TIMEOUT_MS,
    idleTimeoutMs = CLOUD_IDLE_TIMEOUT_MS,
  }: { firstByteTimeoutMs?: number; idleTimeoutMs?: number } = {}
): Promise<void> {
  const target = await resolveSignedUrl(filename, fileType);
  if (!target) {
    fail("unavailable");
    return;
  }

  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };
  const disarm = () => clearTimeout(timer);
  // A consumer disconnect, or a token ending its transfers, stops upstream.
  res.once("close", () => {
    disarm();
    controller.abort();
  });

  const headers: Record<string, string> = { "Accept-Encoding": "identity" };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }

  arm(firstByteTimeoutMs);
  let upstream: AxiosResponse<Readable>;
  try {
    upstream = await publicAxiosGet<Readable>(
      target.url,
      {
        headers,
        responseType: "stream",
        decompress: false,
        maxRedirects: 5,
        validateStatus: () => true,
        signal: controller.signal,
      },
      target.origin
    );
  } catch (error) {
    disarm();
    // The consumer went away or its token ended the transfer: nobody to tell.
    if (res.destroyed) return;
    logger.warn("[Federation] Cloud asset request failed", {
      error: error instanceof Error ? error.message : String(error),
      timedOut,
    });
    fail(timedOut ? "upstream_timeout" : "upstream_error");
    return;
  }

  const body = upstream.data;
  if (!PASSED_THROUGH_STATUSES.has(upstream.status)) {
    disarm();
    body.destroy();
    // A missing object is an unavailable asset; storage auth or server
    // faults must not read as a federation credential failure.
    fail(upstream.status === 404 || upstream.status === 410 ? "unavailable" : "upstream_error");
    return;
  }

  res.status(upstream.status);
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers[name];
    if (typeof value === "string" || typeof value === "number") res.setHeader(name, String(value));
  }
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "HEAD" || upstream.status === 304 || upstream.status === 412 || upstream.status === 416) {
    disarm();
    body.destroy();
    // HEAD reports the length of the body it omits; the others carry none.
    if (req.method !== "HEAD") res.removeHeader("content-length");
    res.end();
    return;
  }

  arm(idleTimeoutMs);
  body.on("data", () => arm(idleTimeoutMs));
  body.on("end", disarm);
  // Never retried once bytes are sent: the consumer sees a cut stream.
  body.on("error", () => {
    disarm();
    res.destroy();
  });
  body.pipe(res);
}
