import type { Request, Response } from "express";
import { logger } from "../../utils/logger";
import { validateRedirectUrl } from "../../utils/security";
import { getConfig, isConfigured } from "../cloudStorage/config";
import { CloudStorageService } from "../CloudStorageService";
import { proxyUpstream, type UpstreamProxyOptions } from "./upstreamProxy";

/**
 * Streams cloud (OpenList) assets to federation consumers (design §7).
 *
 * The signed URL is resolved and refreshed here and never leaves this
 * instance. The configured storage origin is trusted, and every redirect hop
 * must be that origin or a public address (OpenList links often redirect to
 * the storage provider's CDN).
 */

export const CLOUD_PREFIX = "cloud:";
export type CloudFileType = "video" | "audio" | "thumbnail";

export type CloudProxyFailure = "unavailable" | "upstream_error" | "upstream_timeout";

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
  options: UpstreamProxyOptions = {}
): Promise<void> {
  const target = await resolveSignedUrl(filename, fileType);
  if (!target) {
    fail("unavailable");
    return;
  }

  await proxyUpstream(
    req,
    res,
    { url: target.url, trustedOrigin: target.origin, maxRedirects: 5 },
    // A storage auth failure must not read as a federation credential failure.
    (reason) => fail(reason === "upstream_rejected" ? "upstream_error" : reason),
    options
  );
}
