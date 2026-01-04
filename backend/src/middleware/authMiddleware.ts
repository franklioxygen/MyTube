import { NextFunction, Request, Response } from "express";
import { UserPayload, verifyToken } from "../services/authService";

// Extend Express Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

/**
 * Middleware to verify JWT token and attach user to request
 * Does NOT block requests if token is missing/invalid, just leaves req.user undefined
 * Blocking logic should be handled by specific route guards or visitorModeMiddleware
 */
export const authMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    if (decoded) {
      req.user = decoded;
    }
  }

  next();
};
