import { describe, expect, it } from 'vitest';
import { PlaylistCaptureBudget } from '../../../services/downloaders/missav/captureBudget';

const MiB = 1024 * 1024;
// The production limits: 32 bodies, 4 MiB each, 16 MiB in total.
const budget = () => new PlaylistCaptureBudget(32, 4 * MiB, 16 * MiB);

describe('PlaylistCaptureBudget', () => {
  it('keeps a body that fits', () => {
    const b = budget();
    const ticket = b.reserve(1000)!;

    expect(ticket.settle(1000)).toBe(true);
    expect(b.usage).toEqual({ count: 1, bytes: 1000 });
  });

  it('refuses a body that declares itself over the per-body cap, before reading it', () => {
    expect(budget().reserve(64 * MiB)).toBeNull();
  });

  it('reserves the per-body cap for an undeclared length', () => {
    const b = budget();
    b.reserve(Number.NaN);

    expect(b.usage).toEqual({ count: 1, bytes: 4 * MiB });
  });

  it('bounds concurrent reservations, not only completed ones', () => {
    // Every reservation is outstanding at once - nothing has settled - so the
    // cap must hold on reservations alone.
    const b = budget();
    const tickets = Array.from({ length: 80 }, () => b.reserve(Number.NaN));

    expect(tickets.filter(Boolean)).toHaveLength(4); // 4 x 4 MiB = 16 MiB
  });

  it('rechecks the aggregate against the decoded size', () => {
    // A compressed transfer declares its wire size, which can be a fraction of
    // what text() returns. Each response reserves only its small declared
    // length, so all of them pass the reservation check...
    const b = budget();
    const tickets = Array.from({ length: 32 }, () => b.reserve(1024)!);
    expect(tickets.every(Boolean)).toBe(true);

    // ...and only turn out large once decoded. Without the recheck all 32
    // would be kept at nearly 4 MiB each - 128 MiB against a 16 MiB limit.
    const kept = tickets.map((t) => t.settle(4 * MiB - 1)).filter(Boolean);

    expect(kept).toHaveLength(4);
    expect(b.usage.bytes).toBeLessThanOrEqual(16 * MiB);
  });

  it('releases the room when a decoded body is over the per-body cap', () => {
    const b = budget();
    const ticket = b.reserve(1024)!;

    expect(ticket.settle(5 * MiB)).toBe(false);
    expect(b.usage).toEqual({ count: 0, bytes: 0 });
  });

  it('releases the room when a read fails', () => {
    const b = budget();
    b.reserve(1024)!.settle(null);

    expect(b.usage).toEqual({ count: 0, bytes: 0 });
  });

  it('settles a ticket only once', () => {
    // The caller releases after a refused commit; that second call must not
    // release the room a second time.
    const b = budget();
    b.reserve(1024);
    const ticket = b.reserve(1024)!;

    expect(ticket.settle(5 * MiB)).toBe(false);
    expect(ticket.settle(null)).toBe(false);
    expect(b.usage).toEqual({ count: 1, bytes: 1024 });
  });

  it('frees the whole reservation when a read fails', () => {
    const b = budget();
    const first = Array.from({ length: 4 }, () => b.reserve(Number.NaN)!);
    expect(b.reserve(Number.NaN)).toBeNull();

    first[0].settle(null);

    expect(b.reserve(Number.NaN)).not.toBeNull();
  });

  it('frees only the unused part of a reservation when a body is kept', () => {
    // The kept body still counts, so settling a 4 MiB reservation at 1 MiB
    // frees 3 MiB - not enough for another undeclared 4 MiB reservation, but
    // enough for a declared 3 MiB one.
    const b = budget();
    const first = Array.from({ length: 4 }, () => b.reserve(Number.NaN)!);

    first[0].settle(1 * MiB);

    expect(b.reserve(Number.NaN)).toBeNull();
    expect(b.reserve(3 * MiB)).not.toBeNull();
  });
});
