import { Request } from "express";
import { isLoginRequired } from "../../services/passwordService";

/**
 * Resolve the caller role to pass into the visibility-aware storage queries
 * (`getVideos`/`getVideoById`). When login is disabled (single-user mode) every
 * caller is owner-equivalent, so any stale visitor session/JWT role left on the
 * request must be ignored — otherwise hidden videos would wrongly 404 / vanish
 * right after login is turned off. Only scope by role while login is enforced.
 */
export const getVisibilityScopedRole = (
  req: Request
): import("../../services/storageService").VideoCallerRole | undefined => {
  if (!isLoginRequired()) {
    return undefined;
  }
  return req.user?.role as
    | import("../../services/storageService").VideoCallerRole
    | undefined;
};
