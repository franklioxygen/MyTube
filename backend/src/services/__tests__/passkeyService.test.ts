import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    generatePasskeyAuthenticationOptions,
    generatePasskeyRegistrationOptions,
    removeAllPasskeys,
    verifyPasskeyAuthentication,
    verifyPasskeyRegistration
} from "../passkeyService";
import * as storageService from "../storageService";

// Mock dependencies
vi.mock("../storageService", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../authService", () => ({
  generateToken: vi.fn(() => "mock-token"),
}));

describe("passkeyService", () => {
  const mockPasskey = {
    credentialID: "mock-credential-id",
    credentialPublicKey: "mock-public-key",
    counter: 0,
    transports: ["internal"],
    id: "mock-credential-id",
    name: "Passkey 1",
    createdAt: "2023-01-01T00:00:00.000Z",
    rpID: "localhost",
    origin: "http://localhost:5550",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    (storageService.getSettings as any).mockReturnValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generatePasskeyRegistrationOptions", () => {
    it("should generate registration options correctly", async () => {
      const mockOptions = { challenge: "mock-challenge" };
      (generateRegistrationOptions as any).mockResolvedValue(mockOptions);

      const result = await generatePasskeyRegistrationOptions("testuser");

      expect(generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: "testuser",
          attestationType: "none",
          authenticatorSelection: expect.objectContaining({
            authenticatorAttachment: "platform",
            userVerification: "preferred",
          }),
        })
      );
      expect(result).toEqual({
        options: mockOptions,
        challenge: "mock-challenge",
      });
    });

    it("should exclude existing credentials", async () => {
      (storageService.getSettings as any).mockReturnValue({
        passkeys: [mockPasskey],
      });
      (generateRegistrationOptions as any).mockResolvedValue({
        challenge: "mock-challenge",
      });

      await generatePasskeyRegistrationOptions("testuser");

      expect(generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(String), // In the real code it's base64url encoded
            }),
          ]),
        })
      );
    });
  });

  describe("verifyPasskeyRegistration", () => {
    it("should verify and store a new passkey correctly (NO double encoding)", async () => {
      const mockVerification = {
        verified: true,
        registrationInfo: {
          credential: {
            id: "raw-credential-id-from-browser", // Assume simplewebauthn returns this as string/base64url
            publicKey: Buffer.from("mock-public-key"),
            counter: 0,
            transports: ["internal"],
          },
        },
      };
      (verifyRegistrationResponse as any).mockResolvedValue(mockVerification);

      const result = await verifyPasskeyRegistration(
        { response: {}, name: "My Passkey" },
        "mock-challenge"
      );

      expect(result.verified).toBe(true);
      expect(result.passkey?.credentialID).toBe("raw-credential-id-from-browser"); // MUST NOT BE DOUBLE ENCODED
      expect(storageService.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          passkeys: expect.arrayContaining([
            expect.objectContaining({
              credentialID: "raw-credential-id-from-browser",
              name: "My Passkey",
            }),
          ]),
        })
      );
    });

    it("should handle verification failure", async () => {
      (verifyRegistrationResponse as any).mockResolvedValue({ verified: false });

      const result = await verifyPasskeyRegistration({}, "mock-challenge");

      expect(result.verified).toBe(false);
      expect(storageService.saveSettings).not.toHaveBeenCalled();
    });
  });

  describe("generatePasskeyAuthenticationOptions", () => {
    it("should generate authentication options with correct allowCredentials (NO double encoding)", async () => {
      (storageService.getSettings as any).mockReturnValue({
        passkeys: [mockPasskey],
      });
      (generateAuthenticationOptions as any).mockResolvedValue({
        challenge: "mock-challenge",
      });

      const result = await generatePasskeyAuthenticationOptions("localhost");

      expect(generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: expect.arrayContaining([
            expect.objectContaining({
              id: "mock-credential-id", // MUST MATCH STORED ID EXACTLY
              transports: ["internal"],
            }),
          ]),
        })
      );
      expect(result).toEqual({
        options: { challenge: "mock-challenge" },
        challenge: "mock-challenge",
      });
    });

    it("should filter passkeys by RP ID", async () => {
        const passkey1 = { ...mockPasskey, rpID: "domain1.com", id: "id1", credentialID: "id1" };
        const passkey2 = { ...mockPasskey, rpID: "domain2.com", id: "id2", credentialID: "id2" };
        
        (storageService.getSettings as any).mockReturnValue({
            passkeys: [passkey1, passkey2],
        });
        (generateAuthenticationOptions as any).mockResolvedValue({
            challenge: "mock-challenge",
        });

        await generatePasskeyAuthenticationOptions("domain1.com");

        expect(generateAuthenticationOptions).toHaveBeenCalledWith(
            expect.objectContaining({
                allowCredentials: [
                    expect.objectContaining({ id: "id1" })
                ]
            })
        );
    });

    it("should include legacy passkeys (no rpID stored) as fallback", async () => {
        const legacyPasskey = { ...mockPasskey, rpID: undefined, id: "legacy", credentialID: "legacy" };
        
        (storageService.getSettings as any).mockReturnValue({
            passkeys: [legacyPasskey],
        });
        (generateAuthenticationOptions as any).mockResolvedValue({
            challenge: "mock-challenge",
        });

        await generatePasskeyAuthenticationOptions("any-domain.com");

        expect(generateAuthenticationOptions).toHaveBeenCalledWith(
            expect.objectContaining({
                allowCredentials: [
                    expect.objectContaining({ id: "legacy" })
                ]
            })
        );
    });

    it("should throw if no passkeys registered", async () => {
      (storageService.getSettings as any).mockReturnValue({});
      await expect(generatePasskeyAuthenticationOptions()).rejects.toThrow(
        "No passkeys registered"
      );
    });
  });

  describe("verifyPasskeyAuthentication", () => {
    it("should verify authentication successfully", async () => {
      (storageService.getSettings as any).mockReturnValue({
        passkeys: [mockPasskey],
      });
      const mockVerification = {
        verified: true,
        authenticationInfo: { newCounter: 1 },
      };
      (verifyAuthenticationResponse as any).mockResolvedValue(mockVerification);

      const result = await verifyPasskeyAuthentication(
        { id: "mock-credential-id", response: {} },
        "mock-challenge"
      );

      expect(result.verified).toBe(true);
      expect(storageService.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
            passkeys: expect.arrayContaining([
                expect.objectContaining({
                    credentialID: "mock-credential-id",
                    counter: 1
                })
            ])
        })
      );
      expect(storageService.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
            passkeys: expect.arrayContaining([
                expect.objectContaining({
                    credentialID: "mock-credential-id",
                    counter: 1
                })
            ])
        })
      );
      expect(result.token).toBe("mock-token");
      expect(result.role).toBe("admin");
    });

    it("should fail if passkey not found", async () => {
        (storageService.getSettings as any).mockReturnValue({
            passkeys: [mockPasskey],
        });
        
        const result = await verifyPasskeyAuthentication(
            { id: "unknown-id", response: {} },
            "mock-challenge"
        );
        
        expect(result.verified).toBe(false);
        expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
    });
  });
  
  describe("removeAllPasskeys", () => {
      it("should remove all passkeys", () => {
          removeAllPasskeys();
          expect(storageService.saveSettings).toHaveBeenCalledWith({
              passkeys: []
          });
      });
  });
});
