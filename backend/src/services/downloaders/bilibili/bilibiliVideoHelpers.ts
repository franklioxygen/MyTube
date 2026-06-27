import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { redactSensitive, sanitizeLogMessage } from "../../../utils/logger";
import {
  resolveSafeChildPath,
  sanitizePathSegment,
} from "../../../utils/security";
import { BaseDownloader } from "../BaseDownloader";
import { isLikelyBilibiliAuthFailure } from "./bilibiliConfig";

// Helper class to access BaseDownloader methods without circular dependency
export class BilibiliDownloaderHelper extends BaseDownloader {
  async getVideoInfo(): Promise<any> {
    throw new Error("Not implemented");
  }
  async downloadVideo(): Promise<any> {
    throw new Error("Not implemented");
  }

  // Expose protected methods as public for use in module functions
  public handleCancellationErrorPublic(
    error: unknown,
    cleanupFn?: () => void | Promise<void>
  ): Promise<void> {
    return this.handleCancellationError(error, cleanupFn);
  }

  public throwIfCancelledPublic(downloadId?: string): void {
    return this.throwIfCancelled(downloadId);
  }

  public async downloadThumbnailPublic(
    thumbnailUrl: string,
    savePath: string,
    axiosConfig: any = {}
  ): Promise<boolean> {
    return this.downloadThumbnail(thumbnailUrl, savePath, axiosConfig);
  }
}

export function resolveSubtitleDirectory(
  collectionName: string | undefined,
  moveSubtitlesToVideoFolder: boolean,
  videoDir: string
): string {
  if (moveSubtitlesToVideoFolder) {
    return videoDir;
  }

  if (!collectionName) {
    return SUBTITLES_DIR;
  }

  const safeCollectionName = sanitizePathSegment(collectionName);
  return safeCollectionName
    ? resolveSafeChildPath(SUBTITLES_DIR, safeCollectionName)
    : SUBTITLES_DIR;
}

export function formatLegacyMultipartTitle(
  partNumber: number,
  totalParts: number,
  partTitle: string,
): string {
  if (totalParts <= 1) {
    return partTitle;
  }

  const width = String(totalParts).length;
  return `${String(partNumber).padStart(width, "0")} ${partTitle}`;
}

export function resolveExistingThumbnailAbsolutePath(
  existingVideo: {
    thumbnailFilename?: string;
    thumbnailPath?: string | null;
  }
): string | null {
  if (existingVideo.thumbnailPath?.startsWith("/videos/")) {
    return resolveSafeChildPath(
      VIDEOS_DIR,
      existingVideo.thumbnailPath.replace(/^\/videos\//, "")
    );
  }

  if (existingVideo.thumbnailPath?.startsWith("/images/")) {
    return resolveSafeChildPath(
      IMAGES_DIR,
      existingVideo.thumbnailPath.replace(/^\/images\//, "")
    );
  }

  if (!existingVideo.thumbnailFilename) {
    return null;
  }

  return resolveSafeChildPath(
    IMAGES_DIR,
    path.basename(existingVideo.thumbnailFilename)
  );
}

/**
 * Collect the pixel heights of the formats yt-dlp reported for a source, used to
 * decide whether an under-resolution download is worth retrying (issue #295 2-1).
 */
export function extractAvailableHeights(
  info: Record<string, unknown> | null
): number[] {
  if (!info) {
    return [];
  }

  const heights: number[] = [];
  const formats = Array.isArray(info.formats) ? info.formats : [];
  for (const format of formats) {
    const height = (format as { height?: unknown })?.height;
    if (typeof height === "number" && height > 0) {
      heights.push(height);
    }
  }

  // Some responses only expose a top-level height rather than a formats array.
  if (typeof info.height === "number" && info.height > 0) {
    heights.push(info.height);
  }

  return heights;
}

const USER_VISIBLE_YTDLP_FAILURE_LIMIT = 500;

function redactYtDlpFailureDetail(value: string): string {
  const redacted = value
    // Redact the cookie/authorization header value through to end-of-line.
    // Headers sit one-per-line, so consuming the rest of the line scrubs the
    // whole secret; any over-capture here is safe over-redaction, never a leak.
    .replace(
      /\b(cookie|set-cookie|authorization)\s*[:=]\s*[^\r\n]+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\b(SESSDATA|bili_jct|DedeUserID|DedeUserID__ckMd5|buvid3|buvid4|sid)=([^;\s]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /([?&](?:access_token|token|api[_-]?key|apikey|key|signature|sig|auth|authorization|X-Amz-Signature|X-Amz-Credential|Policy)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[REDACTED]@")
    // No leading \b: an absolute path's leading "/" is usually preceded by a
    // space, newline, or start-of-string (all non-word), where \b would not
    // match and the home prefix (e.g. /Users/<name>) would leak.
    .replace(/(?:\/Users|\/home|\/var|\/tmp|\/private)\/[^\s)]+/g, "[local path redacted]")
    .replace(/\b[A-Za-z]:\\[^\s)]+/g, "[local path redacted]");

  // Final pass through the shared logger redactor. Complementary, not redundant:
  // the patterns above only catch token/key/secret material in URL-query form
  // (?key=...), while redactSensitive also strips plain key=value forms
  // (password=, secret=, api_key=, token=) that show up in free-text yt-dlp
  // output. Some already-redacted values can match both passes (for example
  // authorization or query-style token/api_key values), which is harmless — do
  // not drop this call.
  return redactSensitive(redacted);
}

function toUserVisibleYtDlpFailureDetail(value: string): string {
  const redacted = sanitizeLogMessage(redactYtDlpFailureDetail(value.trim()));
  if (redacted.length <= USER_VISIBLE_YTDLP_FAILURE_LIMIT) {
    return redacted;
  }

  return `${redacted.slice(0, USER_VISIBLE_YTDLP_FAILURE_LIMIT)}... [truncated]`;
}

export function formatYtDlpFailureMessage(error: unknown): string {
  const message =
    typeof (error as { message?: unknown })?.message === "string"
      ? (error as { message: string }).message.trim()
      : "";
  const stderr =
    typeof (error as { stderr?: unknown })?.stderr === "string"
      ? (error as { stderr: string }).stderr.trim()
      : "";

  const rawFailure = [message, stderr].filter(Boolean).join("\n");
  const authSignal =
    rawFailure && isLikelyBilibiliAuthFailure(rawFailure)
      ? "Bilibili risk control/auth failure detected."
      : "";
  const combined =
    message && stderr && message !== stderr && !message.includes(stderr)
      ? `${toUserVisibleYtDlpFailureDetail(message)} stderr: ${toUserVisibleYtDlpFailureDetail(stderr)}`
      : message || stderr
        ? toUserVisibleYtDlpFailureDetail(message || stderr)
        : "Unknown error";

  // Append the auth-failure note once. The `includes` guard keeps it from being
  // duplicated when this output is wrapped in an Error and re-formatted (the
  // note text itself trips isLikelyBilibiliAuthFailure on the second pass).
  return authSignal && !combined.includes(authSignal)
    ? `${combined} ${authSignal}`
    : combined;
}
