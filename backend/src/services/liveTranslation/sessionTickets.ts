import crypto from "crypto";
import { LiveTranslationServerConfig } from "./config";

export type LiveTranslationRole = "admin" | "visitor";

export interface LiveTranslationTicket {
  ticket: string;
  role: LiveTranslationRole;
  videoId: string;
  /** Immutable config snapshot (incl. apiKey) taken at mint time. A later
   * settings change cannot retroactively alter an in-flight session. */
  config: LiveTranslationServerConfig;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface CreateTicketInput {
  role: LiveTranslationRole;
  videoId: string;
  config: LiveTranslationServerConfig;
  ttlMs?: number;
}

export type ConsumeTicketResult =
  | { ok: true; ticket: LiveTranslationTicket }
  | { ok: false; reason: "ticket_missing" | "ticket_expired" | "ticket_used" };

/** Short TTL bounds the exposure window of the one-use credential. */
export const DEFAULT_TICKET_TTL_MS = 60_000;
const SWEEP_INTERVAL_MS = 60_000;

// In-memory, single-process store. A restart invalidates outstanding tickets,
// which is acceptable given the short TTL.
const tickets = new Map<string, LiveTranslationTicket>();
let sweepTimer: NodeJS.Timeout | null = null;

function generateTicketId(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function createTicket(input: CreateTicketInput): LiveTranslationTicket {
  const now = Date.now();
  const ttlMs =
    typeof input.ttlMs === "number" && input.ttlMs > 0
      ? input.ttlMs
      : DEFAULT_TICKET_TTL_MS;

  const ticket: LiveTranslationTicket = {
    ticket: generateTicketId(),
    role: input.role,
    videoId: input.videoId,
    config: input.config,
    createdAt: now,
    expiresAt: now + ttlMs,
    used: false,
  };

  tickets.set(ticket.ticket, ticket);
  return ticket;
}

/**
 * Validate and atomically mark a ticket used. A used or expired ticket is
 * rejected with a specific reason. Expired/used entries are retained until the
 * sweeper removes them so a replay reports the precise reason.
 */
export function consumeTicket(
  ticketId: string,
  now: number = Date.now()
): ConsumeTicketResult {
  if (typeof ticketId !== "string" || ticketId.length === 0) {
    return { ok: false, reason: "ticket_missing" };
  }

  const ticket = tickets.get(ticketId);
  if (!ticket) {
    return { ok: false, reason: "ticket_missing" };
  }

  if (ticket.used) {
    return { ok: false, reason: "ticket_used" };
  }

  if (now >= ticket.expiresAt) {
    return { ok: false, reason: "ticket_expired" };
  }

  ticket.used = true;
  return { ok: true, ticket };
}

export function sweepExpiredTickets(now: number = Date.now()): number {
  let removed = 0;
  for (const [id, ticket] of tickets) {
    if (now >= ticket.expiresAt) {
      tickets.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function startTicketSweeper(): void {
  if (sweepTimer) {
    return;
  }
  sweepTimer = setInterval(() => {
    sweepExpiredTickets();
  }, SWEEP_INTERVAL_MS);
  // Do not keep the event loop alive solely for sweeping.
  sweepTimer.unref?.();
}

export function stopTicketSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Test-only: clear all tickets. */
export function __resetTicketsForTest(): void {
  tickets.clear();
}

/** Test/diagnostics: number of stored (not-yet-swept) tickets. */
export function getTicketCount(): number {
  return tickets.size;
}
