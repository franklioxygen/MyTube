import { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isApiKeyAuthorized } from "../../utils/apiKeyAuth";
import { getSettings } from "../../services/storageService";

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
}));

describe("apiKeyAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockReturnValue({
      apiKeyEnabled: true,
      apiKey: "valid-key",
    } as any);
  });

  it("caches authorization on the request object", () => {
    const req = {
      headers: { "x-api-key": "valid-key" },
    } as unknown as Request;

    expect(isApiKeyAuthorized(req)).toBe(true);
    expect(isApiKeyAuthorized(req)).toBe(true);

    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  it("does not share cached authorization across requests", () => {
    const firstReq = {
      headers: { "x-api-key": "valid-key" },
    } as unknown as Request;
    const secondReq = {
      headers: { "x-api-key": "valid-key" },
    } as unknown as Request;

    expect(isApiKeyAuthorized(firstReq)).toBe(true);
    expect(isApiKeyAuthorized(secondReq)).toBe(true);

    expect(getSettings).toHaveBeenCalledTimes(2);
  });
});
