import type { AxiosResponse } from "axios";
import type { Request, Response } from "express";
import type { Readable } from "stream";
import { publicAxiosRequest } from "../../utils/publicAxios";
import { logger } from "../../utils/logger";

/**
 * Streams one upstream HTTP resource to a response (design §7.2). Shared by
 * the peer's cloud-storage proxy and the prime's federation media gateway.
 *
 * Requests go through the guarded public client. Only Range and conditional
 * headers are forwarded, plus the caller's own credentials; only content and
 * validator headers come back. Nothing is retried once bytes are sent, and a
 * consumer disconnect aborts the upstream request.
 */

export const UPSTREAM_FIRST_BYTE_TIMEOUT_MS = 10_000;
export const UPSTREAM_IDLE_TIMEOUT_MS = 60_000;

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
const BODYLESS_STATUSES = new Set([304, 412, 416]);

export interface UpstreamTarget {
  url: string;
  /** Administrator-configured origin allowed to skip public-address checks. */
  trustedOrigin?: string;
  /** Credentials of this instance, never the consumer's. */
  headers?: Record<string, string>;
  maxRedirects: number;
}

export type UpstreamFailure =
  /** 404/410: the resource is gone; says nothing about the service. */
  | "unavailable"
  /** 401/403: the upstream refused this instance's credentials. */
  | "upstream_rejected"
  | "upstream_error"
  | "upstream_timeout";

export interface UpstreamProxyOptions {
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
}

/**
 * Calls `fail` instead of responding when nothing has been sent yet; after
 * streaming starts, a failure ends the response.
 */
export async function proxyUpstream(
  req: Request,
  res: Response,
  target: UpstreamTarget,
  fail: (reason: UpstreamFailure) => void,
  {
    firstByteTimeoutMs = UPSTREAM_FIRST_BYTE_TIMEOUT_MS,
    idleTimeoutMs = UPSTREAM_IDLE_TIMEOUT_MS,
  }: UpstreamProxyOptions = {}
): Promise<void> {
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
  // A consumer disconnect, or a credential ending its transfers, stops upstream.
  res.once("close", () => {
    disarm();
    controller.abort();
  });

  const headers: Record<string, string> = { "Accept-Encoding": "identity", ...target.headers };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }

  arm(firstByteTimeoutMs);
  let upstream: AxiosResponse<Readable>;
  try {
    upstream = await publicAxiosRequest<Readable>(
      {
        url: target.url,
        // Always GET: some storage backends reject HEAD. A HEAD consumer gets
        // the headers and the upstream body is dropped unread.
        method: "get",
        headers,
        responseType: "stream",
        decompress: false,
        maxRedirects: target.maxRedirects,
        validateStatus: () => true,
        signal: controller.signal,
      },
      target.trustedOrigin
    );
  } catch (error) {
    disarm();
    // The consumer went away or its transfer was ended: nobody to tell.
    if (res.destroyed) return;
    logger.warn("[Federation] Upstream request failed", {
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
    fail(
      upstream.status === 404 || upstream.status === 410
        ? "unavailable"
        : upstream.status === 401 || upstream.status === 403
          ? "upstream_rejected"
          : "upstream_error"
    );
    return;
  }

  res.status(upstream.status);
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers[name];
    if (typeof value === "string" || typeof value === "number") res.setHeader(name, String(value));
  }
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "HEAD" || BODYLESS_STATUSES.has(upstream.status)) {
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
