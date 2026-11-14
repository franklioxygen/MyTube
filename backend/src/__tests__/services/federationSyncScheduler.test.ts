import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const syncPeer = vi.hoisted(() => vi.fn());
vi.mock("../../services/federation/peerSync", () => ({ syncPeer }));

import { sqlite } from "../../db";
import {
  backoffFor,
  MAX_BACKOFF_MS,
  MAX_CONCURRENT_SYNCS,
  resetSyncSchedulerForTests,
  runSyncSchedulerTick,
  SYNC_INTERVAL_MS,
} from "../../services/federation/syncScheduler";
import { ensureFederationTables } from "../../services/storageService/migrations/schemaMigrations";

const NOW = 1_800_000_000_000;

const addPeer = (id: string, status = "ok", enabled = 1) =>
  sqlite
    .prepare(
      `INSERT INTO federation_peers
        (id, peer_instance_id, name, base_url, credential_ciphertext, audience, enabled, status, created_at, updated_at)
       VALUES (?, ?, ?, 'http://10.0.0.1', 'x', 'public', ?, ?, 0, 0)`
    )
    .run(id, `instance-${id}`, id, enabled, status);

const setStatus = (id: string, status: string) =>
  sqlite.prepare("UPDATE federation_peers SET status = ? WHERE id = ?").run(status, id);

const syncedIds = () => syncPeer.mock.calls.map(([id]) => id).sort();

beforeAll(() => {
  ensureFederationTables();
});

beforeEach(() => {
  resetSyncSchedulerForTests();
  syncPeer.mockReset();
  syncPeer.mockImplementation(async (peerId: string) => ({ peerId, status: "ok", changed: false }));
  sqlite.exec("DELETE FROM federation_peers;");
});

describe("federation sync scheduler", () => {
  it("syncs enabled peers and leaves disabled ones and those needing the owner alone", async () => {
    addPeer("a");
    addPeer("disabled", "ok", 0);
    addPeer("moved", "identity_mismatch");
    addPeer("keyless", "credential_missing");

    await runSyncSchedulerTick(NOW);

    expect(syncedIds()).toEqual(["a"]);
  });

  it("waits a sync interval between healthy syncs", async () => {
    addPeer("a");
    await runSyncSchedulerTick(NOW);
    syncPeer.mockClear();

    await runSyncSchedulerTick(NOW + 1000);
    expect(syncPeer).not.toHaveBeenCalled();

    await runSyncSchedulerTick(NOW + SYNC_INTERVAL_MS + 10_000);
    expect(syncedIds()).toEqual(["a"]);
  });

  it("backs off failing peers exponentially, up to fifteen minutes", async () => {
    expect(backoffFor(1)).toBe(2 * SYNC_INTERVAL_MS);
    expect(backoffFor(3)).toBe(8 * SYNC_INTERVAL_MS);
    expect(backoffFor(20)).toBe(MAX_BACKOFF_MS);

    addPeer("flaky");
    syncPeer.mockImplementation(async (peerId: string) => ({ peerId, status: "error", changed: false }));
    await runSyncSchedulerTick(NOW);
    setStatus("flaky", "error");
    syncPeer.mockClear();

    // Not again within the first backoff...
    await runSyncSchedulerTick(NOW + SYNC_INTERVAL_MS + 10_000);
    expect(syncPeer).not.toHaveBeenCalled();
    // ...but after it.
    await runSyncSchedulerTick(NOW + backoffFor(1) + 10_000);
    expect(syncedIds()).toEqual(["flaky"]);
  });

  it("syncs a pending peer at once, whatever its old backoff", async () => {
    addPeer("a");
    syncPeer.mockImplementation(async (peerId: string) => ({ peerId, status: "credential_rejected", changed: false }));
    await runSyncSchedulerTick(NOW);
    syncPeer.mockClear();

    // The owner replaced the credential: the peer is pending again.
    setStatus("a", "pending");
    await runSyncSchedulerTick(NOW + 1000);

    expect(syncedIds()).toEqual(["a"]);
  });

  it("runs at most a bounded number of syncs at once", async () => {
    for (const id of ["a", "b", "c", "d"]) addPeer(id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    syncPeer.mockImplementation(async (peerId: string) => {
      await gate;
      return { peerId, status: "ok", changed: false };
    });

    const first = runSyncSchedulerTick(NOW);
    const second = runSyncSchedulerTick(NOW);
    await Promise.resolve();
    expect(syncPeer).toHaveBeenCalledTimes(MAX_CONCURRENT_SYNCS);

    release();
    await Promise.all([first, second]);
  });

  it("survives a sync that throws", async () => {
    addPeer("a");
    syncPeer.mockRejectedValueOnce(new Error("boom"));
    await expect(runSyncSchedulerTick(NOW)).resolves.toBeUndefined();
  });
});
