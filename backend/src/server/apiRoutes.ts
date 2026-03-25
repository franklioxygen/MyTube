import { Express } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import { roleBasedAuthMiddleware } from "../middleware/roleBasedAuthMiddleware";
import { roleBasedSettingsMiddleware } from "../middleware/roleBasedSettingsMiddleware";
import apiRoutes from "../routes/api";
import settingsRoutes from "../routes/settingsRoutes";
import { AuthLimiters } from "./rateLimit";

export const registerApiRoutes = (
  app: Express,
  authLimiters: AuthLimiters
): void => {
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
  app.post("/api/settings/reset-password", authLimiters.resetPasswordLimiter);
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
  app.use("/api", roleBasedAuthMiddleware, apiRoutes);
  app.use("/api/settings", roleBasedSettingsMiddleware, settingsRoutes);
};
