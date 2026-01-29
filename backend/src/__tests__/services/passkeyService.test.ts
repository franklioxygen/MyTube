import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse
} from "@simplewebauthn/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateToken } from "../../services/authService";
import {
    generatePasskeyAuthenticationOptions,
    generatePasskeyRegistrationOptions,
    getPasskeys,
    removeAllPasskeys,
    verifyPasskeyAuthentication,
    verifyPasskeyRegistration
} from "../../services/passkeyService";
import * as storageService from "../../services/storageService";

// Mock dependencies
vi.mock("../../services/storageService");
vi.mock("../../services/authService");
vi.mock("@simplewebauthn/server");
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("PasskeyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageService.getSettings).mockReturnValue({ passkeys: [] });
  });

  describe("getPasskeys", () => {
    it("should return empty array if no passkeys", () => {
        vi.mocked(storageService.getSettings).mockReturnValue({});
        expect(getPasskeys()).toEqual([]);
    });

    it("should return passkeys from settings", () => {
        const mockPasskeys = [{ credentialID: "123", id: "123", credentialPublicKey: "pub", counter: 0, createdAt: "date" }];
        vi.mocked(storageService.getSettings).mockReturnValue({ passkeys: mockPasskeys } as any);
        expect(getPasskeys()).toEqual(mockPasskeys);
    });
  });

  describe("generatePasskeyRegistrationOptions", () => {
      it("should generate options", async () => {
          vi.mocked(generateRegistrationOptions).mockResolvedValue({ challenge: "test-challenge" } as any);
          
          const result = await generatePasskeyRegistrationOptions("user");
          
          expect(generateRegistrationOptions).toHaveBeenCalled();
          expect(result.challenge).toBe("test-challenge");
      });
  });

  describe("verifyPasskeyRegistration", () => {
      it("should verify and save passkey", async () => {
          vi.mocked(verifyRegistrationResponse).mockResolvedValue({
              verified: true,
              registrationInfo: {
                  credential: {
                      id: "cred-id",
                      publicKey: Buffer.from("public-key"),
                      counter: 0,
                      transports: ["internal"]
                  }
              }
          } as any);

          const result = await verifyPasskeyRegistration({ name: "my-key", response: {} }, "challenge");
          
          expect(result.verified).toBe(true);
          expect(result.passkey).toBeDefined();
          expect(result.passkey?.credentialID).toBe("cred-id");
          
          expect(storageService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
              passkeys: expect.arrayContaining([expect.objectContaining({ credentialID: "cred-id" })])
          }));
      });

      it("should return false if verification fails", async () => {
          vi.mocked(verifyRegistrationResponse).mockResolvedValue({ verified: false });
          
          const result = await verifyPasskeyRegistration({}, "challenge");
          
          expect(result.verified).toBe(false);
          expect(storageService.saveSettings).not.toHaveBeenCalled();
      });
  });

  describe("generatePasskeyAuthenticationOptions", () => {
      it("should generate auth options if passkeys exist", async () => {
          const mockPasskeys = [{ credentialID: "123", id: "123", credentialPublicKey: "pub", counter: 0, createdAt: "date", transports: ["internal"] }];
          vi.mocked(storageService.getSettings).mockReturnValue({ passkeys: mockPasskeys } as any);
          vi.mocked(generateAuthenticationOptions).mockResolvedValue({ challenge: "auth-challenge" } as any);

          const result = await generatePasskeyAuthenticationOptions();
          
          expect(result.challenge).toBe("auth-challenge");
      });

      it("should throw if no passkeys", async () => {
          vi.mocked(storageService.getSettings).mockReturnValue({ passkeys: [] });
          
          await expect(generatePasskeyAuthenticationOptions()).rejects.toThrow("No passkeys registered");
      });
  });

  describe("verifyPasskeyAuthentication", () => {
      it("should verify and return token", async () => {
          const mockPasskeys = [{ credentialID: "123", id: "123", credentialPublicKey: "pub", counter: 0, createdAt: "date" }];
          vi.mocked(storageService.getSettings).mockReturnValue({ passkeys: mockPasskeys } as any);
          
          vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
              verified: true,
              authenticationInfo: { newCounter: 1 }
          } as any);
          
          vi.mocked(generateToken).mockReturnValue("mock-token");

          const result = await verifyPasskeyAuthentication({ id: "123" }, "challenge");
          
          expect(result.verified).toBe(true);
          expect(result.token).toBe("mock-token");
          expect(storageService.saveSettings).toHaveBeenCalled(); // Should update counter
      });

      it("should fail if passkey not found", async () => {
           vi.mocked(storageService.getSettings).mockReturnValue({ passkeys: [] });
           const result = await verifyPasskeyAuthentication({ id: "123" }, "challenge");
           expect(result.verified).toBe(false);
      });
  });

  describe("removeAllPasskeys", () => {
      it("should empty passkeys", () => {
          removeAllPasskeys();
          expect(storageService.saveSettings).toHaveBeenCalledWith({ passkeys: [] });
      });
  });
});
