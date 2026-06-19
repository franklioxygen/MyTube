import { IncomingMessage, Server } from "http";
import { Duplex } from "stream";
import { Request } from "express";
import { WebSocketServer } from "ws";
import { logger } from "../utils/logger";
import { getAllowedCorsOrigins, isOriginAllowed } from "./cors";
import * as storageService from "../services/storageService";
import { defaultSettings } from "../types/settings";
import { getLiveTranslationServerConfig } from "../services/liveTranslation/config";
import {
  consumeTicket,
  LiveTranslationTicket,
} from "../services/liveTranslation/sessionTickets";
import {
  BrowserSocketLike,
  LiveTranslationGateway,
} from "../services/liveTranslation/liveTranslationGateway";
import { LiveTranslationErrorCode } from "../services/liveTranslation/protocol";
import { LIVE_TRANSLATION_WS_PATH } from "../controllers/liveTranslationController";

export type UpgradeValidationResult =
  | { ok: true; ticket: LiveTranslationTicket }
  | { ok: false; status: number; code: LiveTranslationErrorCode };

function getHeader(
  request: IncomingMessage,
  name: string
): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseRequestUrl(request: IncomingMessage): URL | null {
  try {
    return new URL(
      request.url || "/",
      `http://${getHeader(request, "host") || "localhost"}`
    );
  } catch {
    return null;
  }
}

/** Extract the one-use ticket. Query param for MVP; `Sec-WebSocket-Protocol` is
 * accepted too so the credential can stay out of access logs. */
function extractTicket(request: IncomingMessage, url: URL | null): string {
  const fromQuery = url?.searchParams.get("ticket");
  if (fromQuery) {
    return fromQuery;
  }
  const proto = getHeader(request, "sec-websocket-protocol");
  if (proto) {
    // Support both a bare ticket and a "ticket,<value>" pair.
    const parts = proto.split(",").map((p) => p.trim());
    if (parts.length === 2 && parts[0] === "ticket") {
      return parts[1];
    }
    return parts[0];
  }
  return "";
}

function isUpgradeOriginAllowed(request: IncomingMessage): boolean {
  const origin = getHeader(request, "origin");
  if (!origin) {
    // Browsers always send Origin on WebSocket upgrades; absence is suspicious.
    return false;
  }

  const allowed = new Set(getAllowedCorsOrigins());

  // Include admin-configured hostnames as both http/https origins.
  try {
    const settings = { ...defaultSettings, ...storageService.getSettings() };
    const rawAllowedHosts =
      typeof settings.allowedHosts === "string" ? settings.allowedHosts : "";
    for (const host of rawAllowedHosts.split(/[\s,]+/).filter(Boolean)) {
      allowed.add(`https://${host}`);
      allowed.add(`http://${host}`);
    }
  } catch {
    // Settings unavailable; fall back to env/default origins + same-host check.
  }

  const reqLike = {
    header: (name: string) => getHeader(request, name),
  } as unknown as Request;

  return isOriginAllowed(origin, reqLike, allowed);
}

/**
 * Validate a live translation WebSocket upgrade. Pure and side-effect-light
 * except that a valid ticket is atomically consumed (one-use). Returns the
 * consumed ticket on success.
 */
export function validateLiveTranslationUpgrade(
  request: IncomingMessage
): UpgradeValidationResult {
  if (!isUpgradeOriginAllowed(request)) {
    return { ok: false, status: 403, code: "origin_forbidden" };
  }

  const url = parseRequestUrl(request);
  const ticketId = extractTicket(request, url);
  if (!ticketId) {
    return { ok: false, status: 401, code: "ticket_missing" };
  }

  const consumed = consumeTicket(ticketId);
  if (!consumed.ok) {
    const status = consumed.reason === "ticket_expired" ? 410 : 401;
    return { ok: false, status, code: consumed.reason };
  }

  const ticket = consumed.ticket;

  // MVP: reject visitor tickets outright.
  if (ticket.role !== "admin") {
    return { ok: false, status: 403, code: "admin_required" };
  }

  // Reject if the feature was disabled or the key removed after minting.
  const current = getLiveTranslationServerConfig();
  if (!current.enabled) {
    return { ok: false, status: 403, code: "feature_disabled" };
  }
  if (!current.apiKeyConfigured) {
    return { ok: false, status: 403, code: "api_key_missing" };
  }

  return { ok: true, ticket };
}

function rejectUpgrade(
  socket: Duplex,
  status: number,
  code: LiveTranslationErrorCode
): void {
  const statusText =
    status === 401
      ? "Unauthorized"
      : status === 403
        ? "Forbidden"
        : status === 410
          ? "Gone"
          : "Bad Request";
  socket.write(
    `HTTP/1.1 ${status} ${statusText}\r\n` +
      "Connection: close\r\n" +
      "Content-Length: 0\r\n" +
      `X-Live-Translation-Error: ${code}\r\n` +
      "\r\n"
  );
  socket.destroy();
}

/**
 * Attach the live translation WebSocket to the HTTP server. Uses `noServer: true`
 * and handles only the exact live translation path so it does not interfere with
 * any other upgrade traffic.
 */
export function registerLiveTranslationSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = parseRequestUrl(request);
    if (!url || url.pathname !== LIVE_TRANSLATION_WS_PATH) {
      // Not ours: leave the socket for other upgrade handlers.
      return;
    }

    let result: UpgradeValidationResult;
    try {
      result = validateLiveTranslationUpgrade(request);
    } catch (err) {
      logger.warn("Live translation upgrade validation failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      rejectUpgrade(socket, 400, "protocol_error");
      return;
    }

    if (!result.ok) {
      rejectUpgrade(socket, result.status, result.code);
      return;
    }

    wss.handleUpgrade(request, socket, head, (browserWs) => {
      const gateway = new LiveTranslationGateway(
        browserWs as unknown as BrowserSocketLike,
        {
          config: result.ticket.config,
          videoId: result.ticket.videoId,
        }
      );
      gateway.start();
    });
  });

  return wss;
}
