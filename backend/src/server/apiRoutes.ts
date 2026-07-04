import { Express } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { authMiddleware } from "../middleware/authMiddleware";
import { roleBasedAuthMiddleware } from "../middleware/roleBasedAuthMiddleware";
import { roleBasedSettingsMiddleware } from "../middleware/roleBasedSettingsMiddleware";
import { serveFeed } from "../controllers/rssController";
import apiRoutes, { apiKeyRoutes } from "../routes/api";
import settingsRoutes from "../routes/settingsRoutes";
import liveTranslationRoutes from "../routes/liveTranslationRoutes";
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
    "/api/settings/verify-user-login",
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

  // Dedicated statistics ingestion limiter mounted ahead of the per-route handler.
  app.post(
    "/api/statistics/events",
    authLimiters.statisticsIngestionLimiter
  );

  // Live translation ticket minting has per-use Gemini cost; rate limit it.
  app.post(
    "/api/live-translation/sessions",
    authLimiters.liveTranslationSessionLimiter
  );

  app.use("/api", authMiddleware);
  app.use("/api", apiKeyRoutes);
  // Mounted inside the session-authenticated, role-checked stack so it inherits
  // cookie-session auth + role enforcement and is not reachable via apiKeyRoutes.
  app.use(
    "/api/live-translation",
    roleBasedAuthMiddleware,
    liveTranslationRoutes
  );
  app.use("/api", roleBasedAuthMiddleware, apiRoutes);
  app.use("/api/settings", roleBasedSettingsMiddleware, settingsRoutes);
};
