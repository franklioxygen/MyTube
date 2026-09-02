import { beforeEach, describe, expect, it, vi } from "vitest";

const unlockAfterSuccessfulAdminPasswordLogin = vi.hoisted(() => vi.fn());
vi.mock("../../services/gestureLoginService", () => ({
  unlockAfterSuccessfulAdminPasswordLogin,
}));

const settings = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../../services/storageService", () => ({
  getSettings: () => settings.current,
  saveSettings: vi.fn(),
}));

const verifyLegacySharedVisitorPassword = vi.hoisted(() => vi.fn());
vi.mock("../../services/userService", () => ({
  hasEnabledLegacySharedUser: vi.fn(() => true),
  hasEnabledVisitorUsers: vi.fn(() => false),
  verifyLegacySharedVisitorPassword,
}));

vi.mock("../../services/authService", () => ({
  generateToken: vi.fn(() => "token"),
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import bcrypt from "bcryptjs";
import {
  confirmAdminPassword,
  verifyAdminPassword,
  verifyPassword,
  verifyVisitorPassword,
} from "../../services/passwordService";

const ADMIN_PASSWORD = "admin-secret";
const VISITOR_PASSWORD = "visitor-secret";

let adminHash: string;

beforeEach(async () => {
  vi.clearAllMocks();
  adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  settings.current = {
    loginEnabled: true,
    passwordLoginAllowed: true,
    password: adminHash,
    visitorUserEnabled: true,
  };
  verifyLegacySharedVisitorPassword.mockImplementation(async (candidate: string) =>
    candidate === VISITOR_PASSWORD
      ? {
          ok: true,
          user: { id: "visitor-1", username: "visitor", sessionVersion: 1 },
        }
      : { ok: false, notConfigured: false }
  );
});

/**
 * A successful admin password login is the only documented way out of a
 * three-failure gesture lock. These tests pin which code paths count as one.
 */
describe("paths that unlock a locked gesture", () => {
  it("verifyAdminPassword on success", async () => {
    const result = await verifyAdminPassword(ADMIN_PASSWORD);

    expect(result.success).toBe(true);
    expect(unlockAfterSuccessfulAdminPasswordLogin).toHaveBeenCalledTimes(1);
  });

  it("the deprecated combined verifyPassword, when it resolves to admin", async () => {
    const result = await verifyPassword(ADMIN_PASSWORD);

    expect(result).toMatchObject({ success: true, role: "admin" });
    expect(unlockAfterSuccessfulAdminPasswordLogin).toHaveBeenCalledTimes(1);
  });

  it("the default admin password before one has been set", async () => {
    settings.current = {
      loginEnabled: true,
      passwordLoginAllowed: true,
      password: undefined,
    };

    const result = await verifyAdminPassword("123");

    expect(result.success).toBe(true);
    expect(unlockAfterSuccessfulAdminPasswordLogin).toHaveBeenCalledTimes(1);
  });
});

describe("paths that must NOT unlock", () => {
  it("an incorrect admin password", async () => {
    const result = await verifyAdminPassword("wrong");

    expect(result.success).toBe(false);
    expect(unlockAfterSuccessfulAdminPasswordLogin).not.toHaveBeenCalled();
  });

  it("a successful visitor password login", async () => {
    const result = await verifyVisitorPassword(VISITOR_PASSWORD);

    expect(result.success).toBe(true);
    expect(unlockAfterSuccessfulAdminPasswordLogin).not.toHaveBeenCalled();
  });

  it("confirmAdminPassword, which is re-auth rather than a login", async () => {
    const result = await confirmAdminPassword(ADMIN_PASSWORD);

    expect(result.success).toBe(true);
    expect(unlockAfterSuccessfulAdminPasswordLogin).not.toHaveBeenCalled();
  });

  it("an admin password submitted while password login is disallowed", async () => {
    settings.current = {
      loginEnabled: true,
      passwordLoginAllowed: false,
      password: adminHash,
    };

    const result = await verifyAdminPassword(ADMIN_PASSWORD);

    expect(result.success).toBe(false);
    expect(unlockAfterSuccessfulAdminPasswordLogin).not.toHaveBeenCalled();
  });
});
