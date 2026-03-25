import bcrypt from "bcryptjs";
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateToken } from "../../services/authService";
import * as passwordService from "../../services/passwordService";
import * as storageService from "../../services/storageService";
import { logger } from "../../utils/logger";

vi.mock("../../services/storageService");
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("../../services/authService", () => ({
  generateToken: vi.fn((payload: { role: "admin" | "visitor" }) =>
    `token-${payload.role}`
  ),
}));
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
    genSalt: vi.fn(),
  },
}));
vi.mock("crypto", () => ({
  default: {
    randomBytes: vi.fn(),
  },
}));

const BCRYPT_HASH = `$2b$10$${"a".repeat(53)}`;

const buildSettings = (overrides: Record<string, unknown> = {}) => ({
  loginEnabled: true,
  passwordLoginAllowed: true,
  allowResetPassword: true,
  visitorUserEnabled: true,
  password: BCRYPT_HASH,
  visitorPassword: "",
  websiteName: "MyTube",
  ...overrides,
});

describe("passwordService", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(storageService.getSettings).mockReturnValue(buildSettings() as any);

    vi.mocked(bcrypt.compare as any).mockResolvedValue(false);
    vi.mocked(bcrypt.genSalt as any).mockResolvedValue("salt-10");
    vi.mocked(bcrypt.hash as any).mockResolvedValue("hashed-password");

    vi.mocked(crypto.randomBytes as any).mockReturnValue(
      Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])
    );
  });

  describe("isLoginRequired", () => {
    it("returns true when loginEnabled is true", () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ loginEnabled: true }) as any
      );

      expect(passwordService.isLoginRequired()).toBe(true);
    });

    it("returns false when loginEnabled is false", () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ loginEnabled: false }) as any
      );

      expect(passwordService.isLoginRequired()).toBe(false);
    });
  });

  describe("isPasswordEnabled", () => {
    it("returns rich state fields when enabled", () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ visitorPassword: "visitor-secret" }) as any
      );

      const result = passwordService.isPasswordEnabled();

      expect(result).toEqual({
        enabled: true,
        loginRequired: true,
        visitorUserEnabled: true,
        isVisitorPasswordSet: true,
        passwordLoginAllowed: true,
        allowResetPassword: true,
        websiteName: "MyTube",
      });
    });

    it("returns disabled when password login is not allowed", () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ passwordLoginAllowed: false }) as any
      );

      const result = passwordService.isPasswordEnabled();

      expect(result.enabled).toBe(false);
      expect(result.passwordLoginAllowed).toBe(false);
    });
  });

  describe("verifyPassword", () => {
    it("rejects when password login is disabled", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ passwordLoginAllowed: false }) as any
      );

      const result = await passwordService.verifyPassword("secret");

      expect(result).toEqual({
        success: false,
        message:
          "Password login is not allowed. Please use passkey authentication.",
      });
    });

    it("logs in as admin for bcrypt match", async () => {
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true);

      const result = await passwordService.verifyPassword("admin-pass");

      expect(result).toEqual({
        success: true,
        role: "admin",
        token: "token-admin",
      });
      expect(generateToken).toHaveBeenCalledWith({ role: "admin" });
    });

    it("does not auto-login admin when admin password is missing", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ password: "" }) as any
      );

      const result = await passwordService.verifyPassword("anything");

      expect(result).toEqual({
        success: false,
        message: "Incorrect password",
      });
    });

    it("logs in as visitor when admin mismatches and visitor matches", async () => {
      const visitorHash = `$2b$10$${"b".repeat(53)}`;
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ visitorPassword: visitorHash }) as any
      );
      vi.mocked(bcrypt.compare as any)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const result = await passwordService.verifyPassword("visitor-pass");

      expect(result).toEqual({
        success: true,
        role: "visitor",
        token: "token-visitor",
      });
      expect(generateToken).toHaveBeenCalledWith({ role: "visitor" });
    });

    it("supports legacy plaintext admin password and migrates hash", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ password: "legacy-admin" }) as any
      );

      const result = await passwordService.verifyPassword("legacy-admin");

      expect(result.success).toBe(true);
      expect(storageService.saveSettings).toHaveBeenCalledWith({
        password: "hashed-password",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        "Detected legacy plaintext password. Automatically migrated to bcrypt hash."
      );
    });

    it("continues login when legacy migration fails", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ password: "legacy-admin" }) as any
      );
      vi.mocked(bcrypt.hash as any).mockRejectedValueOnce(new Error("hash failed"));

      const result = await passwordService.verifyPassword("legacy-admin");

      expect(result).toEqual({
        success: true,
        role: "admin",
        token: "token-admin",
      });
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to migrate legacy plaintext password.",
        expect.any(Error)
      );
    });

    it("falls back to plaintext comparison when bcrypt compare throws", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ password: BCRYPT_HASH }) as any
      );
      vi.mocked(bcrypt.compare as any).mockRejectedValueOnce(new Error("bad hash"));

      const result = await passwordService.verifyPassword(BCRYPT_HASH);

      expect(result.success).toBe(true);
      expect(storageService.saveSettings).toHaveBeenCalledWith({
        password: "hashed-password",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        "Password hash comparison failed. Falling back to legacy plaintext comparison."
      );
    });

    it("returns failure when no password matches", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ visitorPassword: "visitor-plain" }) as any
      );

      const result = await passwordService.verifyPassword("wrong");

      expect(result).toEqual({
        success: false,
        message: "Incorrect password",
      });
    });

    it("treats invalid stored password type as mismatch", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ password: { bad: true } }) as any
      );

      const result = await passwordService.verifyPassword("secret");

      expect(result.success).toBe(false);
      expect(result.message).toBe("Incorrect password");
    });
  });

  describe("verifyAdminPassword", () => {
    it("rejects when password login is disabled", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ passwordLoginAllowed: false }) as any
      );

      const result = await passwordService.verifyAdminPassword("admin");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Password login is not allowed");
    });

    it("logs in admin on successful password check", async () => {
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true);

      const result = await passwordService.verifyAdminPassword("admin");

      expect(result).toEqual({
        success: true,
        role: "admin",
        token: "token-admin",
      });
    });

    it("rejects admin login when no admin password is set", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ password: "" }) as any
      );

      const result = await passwordService.verifyAdminPassword("admin");

      expect(result).toEqual({
        success: false,
        message: "Admin password is not configured.",
      });
    });

    it("returns incorrect admin password on mismatch", async () => {
      vi.mocked(bcrypt.compare as any).mockResolvedValue(false);

      const result = await passwordService.verifyAdminPassword("wrong");

      expect(result).toEqual({
        success: false,
        message: "Incorrect admin password",
      });
    });
  });

  describe("confirmAdminPassword", () => {
    it("returns config error when no admin password is configured", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ password: "" }) as any
      );

      const result = await passwordService.confirmAdminPassword("anything");

      expect(result).toEqual({
        success: false,
        message: "Admin password is not configured.",
      });
    });

    it("confirms admin password even when password login is disabled", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ passwordLoginAllowed: false }) as any
      );
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true);

      const result = await passwordService.confirmAdminPassword("admin");

      expect(result).toEqual({ success: true });
    });

    it("returns incorrect admin password on mismatch", async () => {
      const result = await passwordService.confirmAdminPassword("wrong");

      expect(result).toEqual({
        success: false,
        message: "Incorrect admin password",
      });
    });
  });

  describe("verifyVisitorPassword", () => {
    it("rejects when visitor mode is disabled", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ visitorUserEnabled: false, visitorPassword: "x" }) as any
      );

      const result = await passwordService.verifyVisitorPassword("visitor");

      expect(result).toEqual({
        success: false,
        message: "Visitor user is not enabled.",
      });
    });

    it("rejects when password login is disabled", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ passwordLoginAllowed: false, visitorPassword: "x" }) as any
      );

      const result = await passwordService.verifyVisitorPassword("visitor");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Password login is not allowed");
    });

    it("returns config error when visitor password is missing", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ visitorPassword: "" }) as any
      );

      const result = await passwordService.verifyVisitorPassword("visitor");

      expect(result).toEqual({
        success: false,
        message: "Visitor password is not configured.",
      });
    });

    it("logs in visitor on bcrypt match", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ visitorPassword: BCRYPT_HASH }) as any
      );
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true);

      const result = await passwordService.verifyVisitorPassword("visitor");

      expect(result).toEqual({
        success: true,
        role: "visitor",
        token: "token-visitor",
      });
    });

    it("supports legacy plaintext visitor password and migration", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ visitorPassword: "legacy-visitor" }) as any
      );

      const result = await passwordService.verifyVisitorPassword("legacy-visitor");

      expect(result.success).toBe(true);
      expect(storageService.saveSettings).toHaveBeenCalledWith({
        visitorPassword: "hashed-password",
      });
    });

    it("returns failure on visitor mismatch", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ visitorPassword: "legacy-visitor" }) as any
      );

      const result = await passwordService.verifyVisitorPassword("wrong");

      expect(result).toEqual({
        success: false,
        message: "Incorrect visitor password",
      });
    });
  });

  describe("hashPassword", () => {
    it("hashes using bcrypt salt", async () => {
      vi.mocked(bcrypt.genSalt as any).mockResolvedValue("salt-x");
      vi.mocked(bcrypt.hash as any).mockResolvedValue("hashed-x");

      const result = await passwordService.hashPassword("abc123");

      expect(bcrypt.genSalt).toHaveBeenCalledWith(10);
      expect(bcrypt.hash).toHaveBeenCalledWith("abc123", "salt-x");
      expect(result).toBe("hashed-x");
    });
  });

  describe("getResetPasswordCooldown", () => {
    it("returns 0 when never reset", () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ lastPasswordResetTime: undefined }) as any
      );

      expect(passwordService.getResetPasswordCooldown()).toBe(0);
    });

    it("returns remaining cooldown when reset is recent", () => {
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_000_000);
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ lastPasswordResetTime: 2_000_000 - 15 * 60 * 1000 }) as any
      );

      expect(passwordService.getResetPasswordCooldown()).toBe(45 * 60 * 1000);

      nowSpy.mockRestore();
    });

    it("returns 0 when cooldown has elapsed", () => {
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(5_000_000);
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ lastPasswordResetTime: 5_000_000 - 3_700_000 }) as any
      );

      expect(passwordService.getResetPasswordCooldown()).toBe(0);

      nowSpy.mockRestore();
    });
  });

  describe("resetPassword", () => {
    it("throws when reset is disallowed", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ allowResetPassword: false }) as any
      );

      await expect(passwordService.resetPassword()).rejects.toThrow(
        "Password reset is not allowed. The allowResetPassword setting is disabled."
      );
    });

    it("throws when password login is disabled", async () => {
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ passwordLoginAllowed: false }) as any
      );

      await expect(passwordService.resetPassword()).rejects.toThrow(
        "Password reset is not allowed when password login is disabled"
      );
    });

    it("throws when reset is on cooldown", async () => {
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(3_000_000);
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ lastPasswordResetTime: 3_000_000 - 59 * 60 * 1000 }) as any
      );

      await expect(passwordService.resetPassword()).rejects.toThrow(
        "Password reset is on cooldown. Please wait 1 minute before trying again."
      );

      nowSpy.mockRestore();
    });

    it("generates a password, hashes it, and saves settings", async () => {
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000_000);
      vi.mocked(storageService.getSettings).mockReturnValue(
        buildSettings({ lastPasswordResetTime: undefined }) as any
      );

      const newPassword = await passwordService.resetPassword();

      expect(newPassword).toHaveLength(8);
      expect(bcrypt.hash).toHaveBeenCalled();
      expect(storageService.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          password: "hashed-password",
          loginEnabled: true,
          lastPasswordResetTime: 10_000_000,
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Password has been reset. New password:")
      );

      nowSpy.mockRestore();
    });
  });
});
