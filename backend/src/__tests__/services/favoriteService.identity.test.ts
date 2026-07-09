import { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isLoginRequired } = vi.hoisted(() => ({
  isLoginRequired: vi.fn(),
}));
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../services/passwordService", () => ({ isLoginRequired }));

import {
  OWNER_FAVORITES_USER_ID,
  resolveFavoriteUserId,
} from "../../services/favoriteService";

describe("resolveFavoriteUserId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the owner sentinel when login is disabled", () => {
    isLoginRequired.mockReturnValue(false);
    expect(resolveFavoriteUserId({} as Request)).toBe(OWNER_FAVORITES_USER_ID);
  });

  it("uses the stable users-table id for visitors", () => {
    isLoginRequired.mockReturnValue(true);
    expect(resolveFavoriteUserId({ user: { role: "visitor", userId: "visitor-1" } } as Request)).toBe("visitor-1");
  });

  it("uses the sentinel for legacy admins without a users row", () => {
    isLoginRequired.mockReturnValue(true);
    expect(resolveFavoriteUserId({ user: { role: "admin", id: "ephemeral" } } as Request)).toBe(OWNER_FAVORITES_USER_ID);
  });

  it("returns null for unauthenticated requests when login is required", () => {
    isLoginRequired.mockReturnValue(true);
    expect(resolveFavoriteUserId({} as Request)).toBeNull();
  });
});
