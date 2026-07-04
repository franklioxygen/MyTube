/* eslint-disable @typescript-eslint/no-explicit-any */
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import {
  revokeSessionsByUserId,
  updateSessionUsernames,
} from "../../services/authService";
import * as storageService from "../../services/storageService";
import {
  __resetUserCacheForTests,
  createUser,
  findUserByUsernameInsensitive,
  isUserSessionPayloadValid,
  listUsers,
  migrateLegacySharedVisitorPassword,
  updateUser,
  verifyUserLogin,
} from "../../services/userService";

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../services/authService", () => ({
  revokeSessionsByUserId: vi.fn(() => 2),
  updateSessionUsernames: vi.fn(),
}));

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    genSalt: vi.fn(),
    hash: vi.fn(),
  },
}));

type UserRow = {
  id: string;
  username: string;
  passwordHash: string;
  role: "visitor";
  enabled: number;
  isLegacyShared: number;
  sessionVersion: number;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
};

const makeRow = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: "user-1",
  username: "visitor",
  passwordHash: "$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  role: "visitor",
  enabled: 1,
  isLegacyShared: 0,
  sessionVersion: 1,
  createdAt: 1000,
  updatedAt: 1000,
  lastLoginAt: null,
  ...overrides,
});

let rows: UserRow[] = [];

function setupDbMocks(): void {
  vi.mocked(db.select).mockImplementation(() => {
    const all = vi.fn(() => rows.map((row) => ({ ...row })));
    const from = vi.fn(() => ({ all }));
    return { from } as any;
  });

  vi.mocked(db.insert).mockImplementation(() => {
    const values = vi.fn((value: UserRow) => ({
      run: vi.fn(() => {
        rows.push({ ...value });
      }),
    }));
    return { values } as any;
  });

  vi.mocked(db.update).mockImplementation(() => {
    const set = vi.fn((patch: Partial<UserRow>) => ({
      where: vi.fn(() => ({
        run: vi.fn(() => {
          rows[0] = { ...rows[0], ...patch };
        }),
      })),
    }));
    return { set } as any;
  });

  vi.mocked(db.delete).mockImplementation(() => ({
    where: vi.fn(() => ({
      run: vi.fn(() => {
        rows.shift();
      }),
    })),
  }) as any);
}

describe("userService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    __resetUserCacheForTests();
    setupDbMocks();
    vi.spyOn(Date, "now").mockReturnValue(2000);
    vi.mocked(bcrypt.compare as any).mockResolvedValue(false);
    vi.mocked(bcrypt.genSalt as any).mockResolvedValue("salt-10");
    vi.mocked(bcrypt.hash as any).mockResolvedValue("hashed-password");
    vi.mocked(storageService.getSettings).mockReturnValue({});
  });

  it("lists safe users without password hashes in creation order", () => {
    rows = [
      makeRow({ id: "b", username: "Bob", createdAt: 200 }),
      makeRow({ id: "a", username: "Alice", createdAt: 100 }),
    ];

    expect(listUsers()).toEqual([
      expect.objectContaining({ id: "a", username: "Alice" }),
      expect.objectContaining({ id: "b", username: "Bob" }),
    ]);
    expect(listUsers()[0]).not.toHaveProperty("passwordHash");
  });

  it("creates a hashed visitor user and rejects invalid or duplicate usernames", async () => {
    await expect(
      createUser({ username: "admin", password: "secret1" })
    ).rejects.toMatchObject({ errorKey: "userUsernameReserved" });

    await createUser({ username: "Alice", password: "secret1" });

    expect(bcrypt.hash).toHaveBeenCalledWith("secret1", "salt-10");
    expect(rows[0]).toEqual(
      expect.objectContaining({
        username: "Alice",
        passwordHash: "hashed-password",
        enabled: 1,
        isLegacyShared: 0,
        sessionVersion: 1,
      })
    );
    expect(await createUser({ username: "Bob", password: "secret1" })).not.toHaveProperty(
      "passwordHash"
    );

    await expect(
      createUser({ username: "alice", password: "secret1" })
    ).rejects.toMatchObject({ errorKey: "userUsernameTaken" });
  });

  it("updates password and disabled state with session revocation", async () => {
    rows = [makeRow({ isLegacyShared: 1 })];

    const result = await updateUser("user-1", {
      password: "new-password",
      enabled: false,
    });

    expect(result).toEqual(expect.objectContaining({ enabled: false }));
    expect(rows[0]).toEqual(
      expect.objectContaining({
        passwordHash: "hashed-password",
        enabled: 0,
        isLegacyShared: 0,
        sessionVersion: 2,
      })
    );
    expect(revokeSessionsByUserId).toHaveBeenCalledWith("user-1");
  });

  it("renames users without revoking sessions", async () => {
    rows = [makeRow({ username: "alice" })];

    await updateUser("user-1", { username: "Alice" });

    expect(updateSessionUsernames).toHaveBeenCalledWith("user-1", "Alice");
    expect(revokeSessionsByUserId).not.toHaveBeenCalled();
    expect(findUserByUsernameInsensitive("alice")?.username).toBe("Alice");
  });

  it("verifies login, updates lastLoginAt, and rejects disabled or unknown users generically", async () => {
    rows = [makeRow({ username: "alice" })];
    vi.mocked(bcrypt.compare as any).mockResolvedValueOnce(true);

    const result = await verifyUserLogin("ALICE", "secret1");

    expect(result).toEqual({
      ok: true,
      user: expect.objectContaining({
        id: "user-1",
        username: "alice",
        lastLoginAt: 2000,
      }),
    });
    expect(rows[0].lastLoginAt).toBe(2000);

    rows = [makeRow({ username: "disabled", enabled: 0 })];
    __resetUserCacheForTests();
    await expect(verifyUserLogin("disabled", "secret1")).resolves.toEqual({
      ok: false,
    });

    await expect(verifyUserLogin("missing", "secret1")).resolves.toEqual({
      ok: false,
    });
  });

  it("rehashes legacy plaintext only for legacy shared rows", async () => {
    rows = [
      makeRow({
        username: "visitor",
        passwordHash: "legacy-secret",
        isLegacyShared: 1,
      }),
    ];

    const result = await verifyUserLogin("visitor", "legacy-secret");

    expect(result).toEqual({
      ok: true,
      user: expect.objectContaining({ username: "visitor" }),
    });
    expect(rows[0].passwordHash).toBe("hashed-password");
  });

  it("validates user-backed session payloads against enabled state and session version", () => {
    rows = [makeRow({ id: "user-1", sessionVersion: 3 })];

    expect(isUserSessionPayloadValid({ role: "admin" })).toBe(true);
    expect(
      isUserSessionPayloadValid({
        role: "visitor",
        userId: "user-1",
        sessionVersion: 3,
      })
    ).toBe(true);
    expect(
      isUserSessionPayloadValid({
        role: "visitor",
        userId: "user-1",
        sessionVersion: 2,
      })
    ).toBe(false);
  });

  it("migrates the legacy shared visitor password once and writes a marker", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      visitorPassword: "legacy-secret",
      visitorUserEnabled: true,
    });

    await migrateLegacySharedVisitorPassword();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        username: "visitor",
        passwordHash: "hashed-password",
        enabled: 1,
        isLegacyShared: 1,
      })
    );
    expect(storageService.saveSettings).toHaveBeenCalledWith(
      { visitorPasswordMigratedAt: 2000 },
      { extraWhitelistedKeys: ["visitorPasswordMigratedAt"] }
    );

    vi.mocked(storageService.getSettings).mockReturnValue({
      visitorPasswordMigratedAt: 2000,
      visitorPassword: "legacy-secret",
    });

    await migrateLegacySharedVisitorPassword();

    expect(rows).toHaveLength(1);
  });

  it("marks empty legacy visitor passwords as migrated without creating a user", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      visitorPassword: "",
    });

    await migrateLegacySharedVisitorPassword();

    expect(rows).toEqual([]);
    expect(storageService.saveSettings).toHaveBeenCalledWith(
      { visitorPasswordMigratedAt: 2000 },
      { extraWhitelistedKeys: ["visitorPasswordMigratedAt"] }
    );
  });
});
