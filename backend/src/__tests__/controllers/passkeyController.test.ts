import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as passkeyController from "../../controllers/passkeyController";
import * as authService from "../../services/authService";
import * as passkeyService from "../../services/passkeyService";

// Mock dependencies
vi.mock("../../services/passkeyService");
vi.mock("../../services/authService");

describe("PasskeyController", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let json: any;
    let status: any;

    beforeEach(() => {
        vi.clearAllMocks();
        json = vi.fn();
        status = vi.fn().mockReturnValue({ json });
        
        req = {
            params: {},
            body: {},
            headers: {
                origin: "http://localhost:3000",
                host: "localhost:3000"
            },
        };
        res = {
            json,
            status,
            cookie: vi.fn(),
        } as unknown as Response;
    });

    describe("getPasskeys", () => {
        it("should return safe passkeys", async () => {
            const mockPasskeys = [
                { credentialID: "c1", id: "c1", name: "k1", createdAt: "d1", credentialPublicKey: "pub", counter: 0 }
            ];
            vi.mocked(passkeyService.getPasskeys).mockReturnValue(mockPasskeys as any);

            await passkeyController.getPasskeys(req as Request, res as Response);

            expect(json).toHaveBeenCalledWith({
                passkeys: [{ id: "c1", name: "k1", createdAt: "d1" }]
            });
        });
    });

    describe("checkPasskeysExist", () => {
        it("should return true if passkeys exist", async () => {
            vi.mocked(passkeyService.getPasskeys).mockReturnValue([{} as any]);
            
            await passkeyController.checkPasskeysExist(req as Request, res as Response);
            
            expect(json).toHaveBeenCalledWith({ exists: true });
        });

        it("should return false if no passkeys", async () => {
            vi.mocked(passkeyService.getPasskeys).mockReturnValue([]);
            
            await passkeyController.checkPasskeysExist(req as Request, res as Response);
            
            expect(json).toHaveBeenCalledWith({ exists: false });
        });
    });

    describe("generateRegistrationOptions", () => {
        it("should generate options using correct RPID and Origin", async () => {
            req.body = { userName: "testuser" };
            const mockResult = { challenge: "c", options: {} };
            vi.mocked(passkeyService.generatePasskeyRegistrationOptions).mockResolvedValue(mockResult as any);

            await passkeyController.generateRegistrationOptions(req as Request, res as Response);

            expect(passkeyService.generatePasskeyRegistrationOptions).toHaveBeenCalledWith(
                "testuser", 
                "http://localhost:3000",
                "localhost"
            );
            expect(json).toHaveBeenCalledWith(mockResult);
        });
        
        it("should fallback to host if origin missing", async () => {
            req.headers = { host: "example.com" }; // secure false implies http
            vi.mocked(passkeyService.generatePasskeyRegistrationOptions).mockResolvedValue({} as any);
            
            await passkeyController.generateRegistrationOptions(req as Request, res as Response);
            
             expect(passkeyService.generatePasskeyRegistrationOptions).toHaveBeenCalledWith(
                expect.anything(),
                "http://example.com",
                "example.com"
            );
        });
    });

    describe("verifyRegistration", () => {
        it("should verify successfully", async () => {
            req.body = { body: {}, challenge: "c" };
            vi.mocked(passkeyService.verifyPasskeyRegistration).mockResolvedValue({ verified: true, passkey: {} } as any);

            await passkeyController.verifyRegistration(req as Request, res as Response);

            expect(json).toHaveBeenCalledWith({ success: true, passkey: {} });
        });

        it("should fail validation if missing fields", async () => {
             req.body = {};
             await passkeyController.verifyRegistration(req as Request, res as Response);
             expect(status).toHaveBeenCalledWith(400);
        });

        it("should fail if service verification fails", async () => {
             req.body = { body: {}, challenge: "c" };
             vi.mocked(passkeyService.verifyPasskeyRegistration).mockResolvedValue({ verified: false });

             await passkeyController.verifyRegistration(req as Request, res as Response);
             expect(status).toHaveBeenCalledWith(400);
        });
    });

    describe("generateAuthenticationOptions", () => {
        it("should generate auth options", async () => {
            vi.mocked(passkeyService.generatePasskeyAuthenticationOptions).mockResolvedValue({} as any);
            await passkeyController.generateAuthenticationOptions(req as Request, res as Response);
            expect(json).toHaveBeenCalled();
        });

        it("should handle error (no passkeys)", async () => {
             vi.mocked(passkeyService.generatePasskeyAuthenticationOptions).mockRejectedValue(new Error("No passkeys"));
             await passkeyController.generateAuthenticationOptions(req as Request, res as Response);
             expect(status).toHaveBeenCalledWith(400);
        });
    });

    describe("verifyAuthentication", () => {
        it("should verify and set cookie", async () => {
             req.body = { body: {}, challenge: "c" };
             vi.mocked(passkeyService.verifyPasskeyAuthentication).mockResolvedValue({ verified: true, token: "t", role: "admin" });
             
             await passkeyController.verifyAuthentication(req as Request, res as Response);
             
             expect(authService.setAuthCookie).toHaveBeenCalledWith(res, "t", "admin");
             expect(json).toHaveBeenCalledWith({ success: true, role: "admin" });
        });

        it("should fail validation if missing fields", async () => {
             req.body = {};
             await passkeyController.verifyAuthentication(req as Request, res as Response);
             expect(status).toHaveBeenCalledWith(400);
        });

        it("should fail if service fails", async () => {
             req.body = { body: {}, challenge: "c" };
             vi.mocked(passkeyService.verifyPasskeyAuthentication).mockResolvedValue({ verified: false });
             
             await passkeyController.verifyAuthentication(req as Request, res as Response);
             expect(status).toHaveBeenCalledWith(401);
        });
    });

    describe("removeAllPasskeys", () => {
        it("should remove all passkeys", async () => {
            await passkeyController.removeAllPasskeys(req as Request, res as Response);
            expect(passkeyService.removeAllPasskeys).toHaveBeenCalled();
            expect(json).toHaveBeenCalledWith({ success: true });
        });
    });
});
