import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/tmdbService", () => ({
  testTMDBCredential: vi.fn(),
}));

import { testTMDBCredential as testTMDBCredentialService } from "../../services/tmdbService";
import { testTMDBCredential } from "../../controllers/settingsController";

describe("testTMDBCredential controller", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    req = { body: {} };
    res = {
      json: jsonMock,
      status: statusMock,
    } as unknown as Response;
  });

  it("returns 400 when tmdbApiKey is missing", async () => {
    await testTMDBCredential(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "tmdbApiKey is required",
        errorKey: "tmdbCredentialMissing",
      })
    );
  });

  it("returns success when TMDB credential is valid", async () => {
    req.body = { tmdbApiKey: "  token  " };
    vi.mocked(testTMDBCredentialService).mockResolvedValue({
      success: true,
      authType: "apiKey",
      messageKey: "tmdbCredentialValidApiKey",
    });

    await testTMDBCredential(req as Request, res as Response);

    expect(testTMDBCredentialService).toHaveBeenCalledWith("token");
    expect(jsonMock).toHaveBeenCalledWith({
      success: true,
      authType: "apiKey",
      messageKey: "tmdbCredentialValidApiKey",
    });
  });

  it("returns 400 when TMDB credential is invalid", async () => {
    req.body = { tmdbApiKey: "bad-key" };
    vi.mocked(testTMDBCredentialService).mockResolvedValue({
      success: false,
      authType: "apiKey",
      code: "auth-failed",
      messageKey: "tmdbCredentialInvalid",
      error: "Invalid API key: You must be granted a valid key.",
    });

    await testTMDBCredential(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Invalid API key: You must be granted a valid key.",
        errorKey: "tmdbCredentialInvalid",
      })
    );
  });

  it("returns 502 when TMDB is unreachable", async () => {
    req.body = { tmdbApiKey: "tmdb-key" };
    vi.mocked(testTMDBCredentialService).mockResolvedValue({
      success: false,
      authType: "apiKey",
      code: "request-failed",
      messageKey: "tmdbCredentialRequestFailed",
      error: "Failed to reach TMDB. Please try again.",
    });

    await testTMDBCredential(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(502);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Failed to reach TMDB. Please try again.",
        errorKey: "tmdbCredentialRequestFailed",
      })
    );
  });

  it("rethrows unexpected service errors for asyncHandler to process", async () => {
    req.body = { tmdbApiKey: "tmdb-key" };
    vi.mocked(testTMDBCredentialService).mockRejectedValue(
      new Error("Unexpected TMDB service failure")
    );

    await expect(
      testTMDBCredential(req as Request, res as Response)
    ).rejects.toThrow("Unexpected TMDB service failure");
    expect(statusMock).not.toHaveBeenCalled();
    expect(jsonMock).not.toHaveBeenCalled();
  });
});
