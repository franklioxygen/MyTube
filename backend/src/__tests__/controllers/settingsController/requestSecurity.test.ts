import { Request } from "express";
import { describe, expect, it } from "vitest";
import { isSecurePasskeySettingsRequest } from "../../../controllers/settingsController/requestSecurity";

const makeRequest = (overrides: Partial<Request>): Request =>
  ({
    headers: {},
    cookies: {},
    socket: {},
    ...overrides,
  }) as Request;

describe("settingsController requestSecurity", () => {
  it("allows encrypted requests", () => {
    const req = makeRequest({
      socket: { encrypted: true } as unknown as Request["socket"],
    });

    expect(isSecurePasskeySettingsRequest(req)).toBe(true);
  });

  it("allows secure browser origins with matching csrf token", () => {
    const req = makeRequest({
      cookies: { mytube_csrf: "token" },
      get: ((key: string) => {
        const headers: Record<string, string> = {
          origin: "https://mytube.example.test",
          "x-csrf-token": "token",
        };
        return headers[key.toLowerCase()];
      }) as unknown as Request["get"],
    });

    expect(isSecurePasskeySettingsRequest(req)).toBe(true);
  });

  it("allows localhost browser origins with matching csrf token", () => {
    const req = makeRequest({
      cookies: { mytube_csrf: "token" },
      headers: {
        origin: "http://localhost:5173",
        "x-csrf-token": "token",
      },
    });

    expect(isSecurePasskeySettingsRequest(req)).toBe(true);
  });

  it("rejects browser origins without a matching csrf token", () => {
    const req = makeRequest({
      cookies: { mytube_csrf: "token" },
      headers: {
        origin: "https://mytube.example.test",
        "x-csrf-token": "different",
      },
    });

    expect(isSecurePasskeySettingsRequest(req)).toBe(false);
  });

  it("rejects non-local http origins even with a matching csrf token", () => {
    const req = makeRequest({
      cookies: { mytube_csrf: "token" },
      headers: {
        origin: "http://mytube.example.test",
        "x-csrf-token": "token",
      },
    });

    expect(isSecurePasskeySettingsRequest(req)).toBe(false);
  });
});
