import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerApiRoutes } from "../../server/apiRoutes";
import { authMiddleware } from "../../middleware/authMiddleware";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import { roleBasedSettingsMiddleware } from "../../middleware/roleBasedSettingsMiddleware";
import apiRoutes from "../../routes/api";
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
    const app = { use: vi.fn() } as any;
    const authLimiter = vi.fn();

    registerApiRoutes(app, authLimiter as any);

    expect(app.use).toHaveBeenCalledWith(
      "/api/settings/verify-password",
      authLimiter
    );
    expect(app.use).toHaveBeenCalledWith(
      "/api/settings/verify-admin-password",
      authLimiter
    );
    expect(app.use).toHaveBeenCalledWith(
      "/api/settings/verify-visitor-password",
      authLimiter
    );
    expect(app.use).toHaveBeenCalledWith(
      "/api/settings/reset-password",
      authLimiter
    );
    expect(app.use).toHaveBeenCalledWith(
      "/api/settings/passkeys/authenticate",
      authLimiter
    );
    expect(app.use).toHaveBeenCalledWith(
      "/api/settings/passkeys/authenticate/verify",
      authLimiter
    );

    expect(app.use).toHaveBeenCalledWith("/api", authMiddleware);
    expect(app.use).toHaveBeenCalledWith(
      "/api",
      roleBasedAuthMiddleware,
      apiRoutes
    );
    expect(app.use).toHaveBeenCalledWith(
      "/api/settings",
      roleBasedSettingsMiddleware,
      settingsRoutes
    );

    expect(app.use).toHaveBeenCalledTimes(9);
  });
});
