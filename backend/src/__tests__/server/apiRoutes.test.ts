/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerApiRoutes } from "../../server/apiRoutes";
import { authMiddleware } from "../../middleware/authMiddleware";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import { roleBasedSettingsMiddleware } from "../../middleware/roleBasedSettingsMiddleware";
import apiRoutes, { apiKeyRoutes } from "../../routes/api";
import settingsRoutes from "../../routes/settingsRoutes";

vi.mock("../../middleware/authMiddleware", () => ({
  authMiddleware: vi.fn(),
}));

vi.mock("../../middleware/roleBasedAuthMiddleware", () => ({
  roleBasedAuthMiddleware: vi.fn(),
}));

vi.mock("../../middleware/roleBasedSettingsMiddleware", () => ({
  roleBasedSettingsMiddleware: vi.fn(),
}));

vi.mock("../../routes/api", () => ({
  apiKeyRoutes: { __router: "apiKey" },
  default: { __router: "api" },
}));

vi.mock("../../routes/settingsRoutes", () => ({
  default: { __router: "settings" },
}));

describe("registerApiRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers limiter-protected auth endpoints and API middlewares", () => {
    const app = { use: vi.fn(), post: vi.fn() } as any;
    const authLimiters = {
      adminPasswordLimiter: vi.fn(),
      visitorPasswordLimiter: vi.fn(),
      adminReauthLimiter: vi.fn(),
      passkeyAuthLimiter: vi.fn(),
      passkeyRegistrationLimiter: vi.fn(),
    };

    registerApiRoutes(app, authLimiters as any);

    expect(app.post).toHaveBeenCalledWith(
      "/api/settings/verify-password",
      authLimiters.adminPasswordLimiter
    );
    expect(app.post).toHaveBeenCalledWith(
      "/api/settings/verify-admin-password",
      authLimiters.adminPasswordLimiter
    );
    expect(app.post).toHaveBeenCalledWith(
      "/api/settings/verify-visitor-password",
      authLimiters.visitorPasswordLimiter
    );
    expect(app.post).toHaveBeenCalledWith(
      "/api/settings/confirm-admin-password",
      authLimiters.adminReauthLimiter
    );
    expect(app.post).toHaveBeenCalledWith(
      "/api/settings/passkeys/authenticate",
      authLimiters.passkeyAuthLimiter
    );
    expect(app.post).toHaveBeenCalledWith(
      "/api/settings/passkeys/authenticate/verify",
      authLimiters.passkeyAuthLimiter
    );
    expect(app.post).toHaveBeenCalledWith(
      "/api/settings/passkeys/register",
      authLimiters.passkeyRegistrationLimiter
    );
    expect(app.post).toHaveBeenCalledWith(
      "/api/settings/passkeys/register/verify",
      authLimiters.passkeyRegistrationLimiter
    );

    expect(app.use).toHaveBeenNthCalledWith(1, "/api", authMiddleware);
    expect(app.use).toHaveBeenNthCalledWith(2, "/api", apiKeyRoutes);
    expect(app.use).toHaveBeenNthCalledWith(
      3,
      "/api",
      roleBasedAuthMiddleware,
      apiRoutes
    );
    expect(app.use).toHaveBeenNthCalledWith(
      4,
      "/api/settings",
      roleBasedSettingsMiddleware,
      settingsRoutes
    );

    expect(app.post).toHaveBeenCalledTimes(8);
    expect(app.use).toHaveBeenCalledTimes(4);
  });
});
