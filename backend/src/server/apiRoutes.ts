import { Express, RequestHandler } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import { roleBasedAuthMiddleware } from "../middleware/roleBasedAuthMiddleware";
import { roleBasedSettingsMiddleware } from "../middleware/roleBasedSettingsMiddleware";
import apiRoutes from "../routes/api";
import settingsRoutes from "../routes/settingsRoutes";

export const registerApiRoutes = (
  app: Express,
  authLimiter: RequestHandler
): void => {
  app.use("/api/settings/verify-password", authLimiter);
  app.use("/api/settings/verify-admin-password", authLimiter);
  app.use("/api/settings/verify-visitor-password", authLimiter);
  app.use("/api/settings/reset-password", authLimiter);
  app.use("/api/settings/passkeys/authenticate", authLimiter);
  app.use("/api/settings/passkeys/authenticate/verify", authLimiter);

  app.use("/api", authMiddleware);
  app.use("/api", roleBasedAuthMiddleware, apiRoutes);
  app.use("/api/settings", roleBasedSettingsMiddleware, settingsRoutes);
};
