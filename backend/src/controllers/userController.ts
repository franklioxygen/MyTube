import { Request, Response } from "express";
import {
  UserConflictError,
  UserNotFoundError,
  UserValidationError,
} from "../errors/UserErrors";
import * as userService from "../services/userService";
import { getStringParam } from "../utils/paramUtils";

function isBodyObject(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

function sendUserError(res: Response, error: unknown): boolean {
  if (error instanceof UserValidationError) {
    res.status(400).json({
      success: false,
      error: error.message,
      errorKey: error.errorKey,
    });
    return true;
  }

  if (error instanceof UserConflictError) {
    res.status(409).json({
      success: false,
      error: error.message,
      errorKey: error.errorKey,
    });
    return true;
  }

  if (error instanceof UserNotFoundError) {
    res.status(404).json({
      success: false,
      error: error.message,
      errorKey: error.errorKey,
    });
    return true;
  }

  return false;
}

export async function listUsers(_req: Request, res: Response): Promise<void> {
  res.json({ success: true, users: userService.listUsers() });
}

export async function createUser(req: Request, res: Response): Promise<void> {
  if (!isBodyObject(req.body)) {
    // No errorKey: this is a malformed request, not a case the UI translates.
    res.status(400).json({
      success: false,
      error: "Request body must be an object.",
    });
    return;
  }

  try {
    const user = await userService.createUser({
      username: req.body.username as string,
      password: req.body.password as string,
    });
    res.status(201).json({ success: true, user });
  } catch (error) {
    if (!sendUserError(res, error)) {
      throw error;
    }
  }
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const id = getStringParam(req.params.id) ?? "";
  if (!isBodyObject(req.body)) {
    res.status(400).json({
      success: false,
      error: "Nothing to update.",
      errorKey: "userEmptyPatch",
    });
    return;
  }

  const patch: {
    username?: string;
    password?: string;
    enabled?: boolean;
  } = {};

  if (Object.prototype.hasOwnProperty.call(req.body, "username")) {
    patch.username = req.body.username as string;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "password")) {
    patch.password = req.body.password as string;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "enabled")) {
    patch.enabled = req.body.enabled as boolean;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({
      success: false,
      error: "Nothing to update.",
      errorKey: "userEmptyPatch",
    });
    return;
  }

  try {
    const user = await userService.updateUser(id, patch);
    res.json({ success: true, user });
  } catch (error) {
    if (!sendUserError(res, error)) {
      throw error;
    }
  }
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const id = getStringParam(req.params.id) ?? "";

  try {
    userService.deleteUser(id);
    res.json({ success: true });
  } catch (error) {
    if (!sendUserError(res, error)) {
      throw error;
    }
  }
}
