import { Request, Response } from "express";
import {
  createAdminTrustLevelError,
  isAdminTrustLevelAtLeast,
} from "../config/adminTrust";
import { getErrorMessage } from "../utils/errors";
import { logger } from "../utils/logger";
import { errorResponse, successResponse } from "../utils/response";
import { getYtDlpStatus, updateYtDlp } from "../utils/ytdlp/maintenance";

/**
 * Updating yt-dlp installs a package inside the container, so it needs the same
 * trust level as the other container-mutating features (hooks, raw config).
 */
const ensureUpdateAllowed = (res: Response): boolean => {
  if (isAdminTrustLevelAtLeast("container")) {
    return true;
  }

  res.status(403).json(createAdminTrustLevelError("container"));
  return false;
};

/**
 * GET /api/settings/ytdlp/version
 * Report the yt-dlp the backend actually runs, plus the latest PyPI release.
 */
export const getYtDlpVersion = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Reading local status must not create an implicit outbound request. PyPI is
  // queried only when the caller explicitly asks to check for an update.
  const checkLatest = req.query.checkLatest === "true";
  const status = await getYtDlpStatus({ checkLatest });
  res.json(successResponse(status));
};

/**
 * POST /api/settings/ytdlp/update
 * Upgrade yt-dlp in place so a broken extractor can be fixed without
 * rebuilding the image.
 */
export const updateYtDlpVersion = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!ensureUpdateAllowed(res)) {
    return;
  }

  const currentStatus = await getYtDlpStatus({ checkLatest: false });
  if (!currentStatus.updateSupported) {
    res.status(409).json(
      errorResponse(
        `yt-dlp is pinned to ${currentStatus.path} via YT_DLP_PATH. Update that binary yourself or unset YT_DLP_PATH.`,
        { errorKey: "ytDlpUpdateCustomPath" }
      )
    );
    return;
  }

  try {
    const result = await updateYtDlp();
    res.json(successResponse(result));
  } catch (error: unknown) {
    const message = getErrorMessage(error, "yt-dlp update failed");
    logger.error(`[yt-dlp] Update failed: ${message}`);
    res
      .status(500)
      .json(errorResponse(message, { errorKey: "ytDlpUpdateFailed" }));
  }
};
