import { Express } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { authMiddleware } from "../middleware/authMiddleware";
import { roleBasedAuthMiddleware } from "../middleware/roleBasedAuthMiddleware";
import { roleBasedSettingsMiddleware } from "../middleware/roleBasedSettingsMiddleware";
import { serveFeed } from "../controllers/rssController";
import apiRoutes, { apiKeyRoutes } from "../routes/api";
import settingsRoutes from "../routes/settingsRoutes";
import { AuthLimiters } from "./rateLimit";

type RegisterApiRoutesOptions = {
  includeFeedRoute?: boolean;
};

export const registerFeedRoute = (
  app: Express,
  authLimiters: AuthLimiters
): void => {
  // RSS Feed: public endpoint, token is the credential, no session/auth required
  app.get("/feed/:token", authLimiters.feedLimiter, asyncHandler(serveFeed));
  app.get(
    "/api/rss/feed/:token",
    authLimiters.feedLimiter,
    asyncHandler(serveFeed)
  );
};

export const registerApiRoutes = (
  app: Express,
  authLimiters: AuthLimiters,
  options: RegisterApiRoutesOptions = {}
): void => {
  if (options.includeFeedRoute !== false) {
    registerFeedRoute(app, authLimiters);
  }

  app.post(
    "/api/settings/verify-password",
    authLimiters.adminPasswordLimiter
  );
  app.post(
    "/api/settings/verify-admin-password",
    authLimiters.adminPasswordLimiter
  );
  app.post(
    "/api/settings/verify-visitor-password",
    authLimiters.visitorPasswordLimiter
  );
  app.post(
    "/api/settings/confirm-admin-password",
    authLimiters.adminReauthLimiter
  );
  app.post(
    "/api/settings/passkeys/authenticate",
    authLimiters.passkeyAuthLimiter
  );
  app.post(
    "/api/settings/passkeys/authenticate/verify",
    authLimiters.passkeyAuthLimiter
  );
  app.post(
    "/api/settings/passkeys/register",
    authLimiters.passkeyRegistrationLimiter
  );
  app.post(
    "/api/settings/passkeys/register/verify",
    authLimiters.passkeyRegistrationLimiter
  );

  app.use("/api", authMiddleware);
  app.use("/api", apiKeyRoutes);
  app.use("/api", roleBasedAuthMiddleware, apiRoutes);
  app.use("/api/settings", roleBasedSettingsMiddleware, settingsRoutes);
};
