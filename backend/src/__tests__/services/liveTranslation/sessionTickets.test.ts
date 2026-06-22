import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetTicketsForTest,
  consumeTicket,
  createTicket,
  getTicketCount,
  sweepExpiredTickets,
} from "../../../services/liveTranslation/sessionTickets";
import { LiveTranslationServerConfig } from "../../../services/liveTranslation/config";

const config: LiveTranslationServerConfig = {
  enabled: true,
  model: "gemini-3.5-live-translate-preview",
  sourceLanguage: "auto",
  targetLanguage: "en",
  apiKey: "secret-key",
  apiKeyConfigured: true,
};

describe("liveTranslation sessionTickets", () => {
  beforeEach(() => __resetTicketsForTest());
  afterEach(() => __resetTicketsForTest());

  it("mints a ticket carrying an immutable config snapshot", () => {
    const ticket = createTicket({ role: "admin", videoId: "abc123", config });
    expect(ticket.ticket).toBeTruthy();
    expect(ticket.role).toBe("admin");
    expect(ticket.videoId).toBe("abc123");
    expect(ticket.config).toEqual(config);
    expect(ticket.used).toBe(false);
    expect(ticket.expiresAt).toBeGreaterThan(ticket.createdAt);
  });

  it("can be consumed exactly once", () => {
    const ticket = createTicket({ role: "admin", videoId: "v", config });
    const first = consumeTicket(ticket.ticket);
    expect(first.ok).toBe(true);
    const second = consumeTicket(ticket.ticket);
    expect(second).toEqual({ ok: false, reason: "ticket_used" });
  });

  it("rejects a missing ticket", () => {
    expect(consumeTicket("nope")).toEqual({ ok: false, reason: "ticket_missing" });
    expect(consumeTicket("")).toEqual({ ok: false, reason: "ticket_missing" });
  });

  it("rejects an expired ticket", () => {
    const ticket = createTicket({
      role: "admin",
      videoId: "v",
      config,
      ttlMs: 1000,
    });
    const result = consumeTicket(ticket.ticket, ticket.createdAt + 5000);
    expect(result).toEqual({ ok: false, reason: "ticket_expired" });
  });

  it("sweeps expired tickets only", () => {
    const fresh = createTicket({ role: "admin", videoId: "v1", config, ttlMs: 60_000 });
    const stale = createTicket({ role: "admin", videoId: "v2", config, ttlMs: 1000 });
    expect(getTicketCount()).toBe(2);

    const removed = sweepExpiredTickets(stale.createdAt + 5000);
    expect(removed).toBe(1);
    expect(getTicketCount()).toBe(1);
    // The fresh ticket is still consumable.
    expect(consumeTicket(fresh.ticket).ok).toBe(true);
  });
});
