import { IncomingMessage, Server } from "http";
import { Duplex } from "stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerLiveTranslationSocket,
  validateLiveTranslationUpgrade,
} from "../../server/liveTranslationSocket";
import * as storageService from "../../services/storageService";
import {
  __resetTicketsForTest,
  createTicket,
} from "../../services/liveTranslation/sessionTickets";
import { LiveTranslationServerConfig } from "../../services/liveTranslation/config";

vi.mock("../../services/storageService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/storageService")>();
  return { ...actual, getSettings: vi.fn() };
});

const serverConfig: LiveTranslationServerConfig = {
  enabled: true,
  model: "gemini-3.5-live-translate-preview",
  sourceLanguage: "auto",
  targetLanguage: "en",
  apiKey: "secret-key",
  apiKeyConfigured: true,
};

function makeRequest(opts: {
  ticket?: string;
  protocolTicket?: string;
  origin?: string | null;
  host?: string;
  role?: "admin" | "visitor";
}): IncomingMessage {
  const host = opts.host ?? "localhost:5551";
  const url = opts.ticket
    ? `/api/live-translation/ws?ticket=${encodeURIComponent(opts.ticket)}`
    : "/api/live-translation/ws";
  const headers: Record<string, string> = { host };
  if (opts.origin !== null) {
    headers.origin = opts.origin ?? "http://localhost:5556";
  }
  if (opts.protocolTicket) {
    headers["sec-websocket-protocol"] = `ticket, ${opts.protocolTicket}`;
  }
  return { url, headers } as unknown as IncomingMessage;
}

function mintTicket(role: "admin" | "visitor" = "admin"): string {
  return createTicket({ role, videoId: "v1", config: serverConfig }).ticket;
}

describe("validateLiveTranslationUpgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetTicketsForTest();
    // Enabled feature with a configured key by default.
    (storageService.getSettings as any).mockReturnValue({
      liveTranslationEnabled: true,
      liveTranslationApiKey: "secret-key",
      liveTranslationTargetLanguage: "en",
    });
  });

  it("accepts a valid ticket from a same-origin request", () => {
    const ticket = mintTicket();
    const result = validateLiveTranslationUpgrade(makeRequest({ ticket }));
    expect(result.ok).toBe(true);
  });

  it("accepts a valid ticket from the WebSocket protocol header", () => {
    const ticket = mintTicket();
    const result = validateLiveTranslationUpgrade(
      makeRequest({ protocolTicket: ticket })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a missing ticket", () => {
    const result = validateLiveTranslationUpgrade(makeRequest({}));
    expect(result).toMatchObject({ ok: false, status: 401, code: "ticket_missing" });
  });

  it("rejects a wrong origin before consuming the ticket", () => {
    const ticket = mintTicket();
    const result = validateLiveTranslationUpgrade(
      makeRequest({ ticket, origin: "http://evil.example" })
    );
    expect(result).toMatchObject({ ok: false, status: 403, code: "origin_forbidden" });
    // The ticket must still be usable since origin failed first.
    const retry = validateLiveTranslationUpgrade(makeRequest({ ticket }));
    expect(retry.ok).toBe(true);
  });

  it("rejects a missing Origin header", () => {
    const ticket = mintTicket();
    const result = validateLiveTranslationUpgrade(
      makeRequest({ ticket, origin: null })
    );
    expect(result).toMatchObject({ ok: false, code: "origin_forbidden" });
  });

  it("rejects a reused ticket", () => {
    const ticket = mintTicket();
    expect(validateLiveTranslationUpgrade(makeRequest({ ticket })).ok).toBe(true);
    const second = validateLiveTranslationUpgrade(makeRequest({ ticket }));
    expect(second).toMatchObject({ ok: false, code: "ticket_used" });
  });

  it("rejects a visitor ticket in MVP", () => {
    const ticket = mintTicket("visitor");
    const result = validateLiveTranslationUpgrade(makeRequest({ ticket }));
    expect(result).toMatchObject({ ok: false, status: 403, code: "admin_required" });
  });

  it("rejects when the feature was disabled after minting", () => {
    const ticket = mintTicket();
    (storageService.getSettings as any).mockReturnValue({
      liveTranslationEnabled: false,
    });
    const result = validateLiveTranslationUpgrade(makeRequest({ ticket }));
    expect(result).toMatchObject({ ok: false, code: "feature_disabled" });
  });
});

describe("registerLiveTranslationSocket", () => {
  it("closes sockets for unhandled upgrade paths", () => {
    const mockServer = {
      on: vi.fn(),
    } as unknown as Server;

    registerLiveTranslationSocket(mockServer);

    expect(mockServer.on).toHaveBeenCalledWith("upgrade", expect.any(Function));
    const upgradeHandler = (mockServer.on as any).mock.calls[0][1];

    const mockRequest = {
      url: "/some/other/path",
      headers: { host: "localhost" },
    } as IncomingMessage;

    const mockSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
    } as unknown as Duplex;

    const mockHead = Buffer.from([]);

    upgradeHandler(mockRequest, mockSocket, mockHead);

    expect(mockSocket.write).toHaveBeenCalledWith("HTTP/1.1 404 Not Found\r\n\r\n");
    expect(mockSocket.destroy).toHaveBeenCalled();
  });
});
