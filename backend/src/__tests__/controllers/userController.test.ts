/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as userController from "../../controllers/userController";
import {
  UserConflictError,
  UserNotFoundError,
  UserValidationError,
} from "../../errors/UserErrors";
import * as userService from "../../services/userService";

vi.mock("../../services/userService", () => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  listUsers: vi.fn(),
  updateUser: vi.fn(),
}));

const safeUser = {
  id: "user-1",
  username: "alice",
  role: "visitor" as const,
  enabled: true,
  isLegacyShared: false,
  sessionVersion: 1,
  createdAt: 1000,
  updatedAt: 1000,
  lastLoginAt: null,
};

describe("userController", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { body: {}, params: {} };
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    res = { json, status };
  });

  it("lists safe users without password hashes", async () => {
    vi.mocked(userService.listUsers).mockReturnValue([safeUser]);

    await userController.listUsers(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({ success: true, users: [safeUser] });
    expect(json.mock.calls[0][0].users[0]).not.toHaveProperty("passwordHash");
  });

  it("creates a visitor user with a 201 response", async () => {
    req.body = { username: "alice", password: "secret1" };
    vi.mocked(userService.createUser).mockResolvedValue(safeUser);

    await userController.createUser(req as Request, res as Response);

    expect(userService.createUser).toHaveBeenCalledWith({
      username: "alice",
      password: "secret1",
    });
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({ success: true, user: safeUser });
  });

  it("maps validation and conflict errors to API response bodies", async () => {
    req.body = { username: "admin", password: "secret1" };
    vi.mocked(userService.createUser).mockRejectedValueOnce(
      new UserValidationError("This username is reserved.", "userUsernameReserved")
    );

    await userController.createUser(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: "This username is reserved.",
      errorKey: "userUsernameReserved",
    });

    vi.clearAllMocks();
    vi.mocked(userService.createUser).mockRejectedValueOnce(
      new UserConflictError()
    );

    await userController.createUser(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: "Username is already taken.",
      errorKey: "userUsernameTaken",
    });
  });

  it("rejects empty update patches", async () => {
    req.params = { id: "user-1" };
    req.body = {};

    await userController.updateUser(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: "Nothing to update.",
      errorKey: "userEmptyPatch",
    });
    expect(userService.updateUser).not.toHaveBeenCalled();
  });

  it("updates allowed fields and maps missing users to 404", async () => {
    req.params = { id: "user-1" };
    req.body = { username: "Alice", password: "secret2", enabled: false };
    vi.mocked(userService.updateUser).mockResolvedValue({
      ...safeUser,
      username: "Alice",
      enabled: false,
    });

    await userController.updateUser(req as Request, res as Response);

    expect(userService.updateUser).toHaveBeenCalledWith("user-1", {
      username: "Alice",
      password: "secret2",
      enabled: false,
    });
    expect(json).toHaveBeenCalledWith({
      success: true,
      user: expect.objectContaining({ username: "Alice", enabled: false }),
    });

    vi.clearAllMocks();
    vi.mocked(userService.updateUser).mockRejectedValueOnce(
      new UserNotFoundError()
    );

    await userController.updateUser(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: "User not found.",
      errorKey: "userNotFound",
    });
  });

  it("deletes users and maps not found errors", async () => {
    req.params = { id: "user-1" };

    await userController.deleteUser(req as Request, res as Response);

    expect(userService.deleteUser).toHaveBeenCalledWith("user-1");
    expect(json).toHaveBeenCalledWith({ success: true });

    vi.clearAllMocks();
    vi.mocked(userService.deleteUser).mockImplementationOnce(() => {
      throw new UserNotFoundError();
    });

    await userController.deleteUser(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: "User not found.",
      errorKey: "userNotFound",
    });
  });
});
