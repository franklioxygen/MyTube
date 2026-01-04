import { NextFunction, Request, Response } from "express";

/**
 * Middleware to enforce role-based access control
 * Visitors (userRole === 'visitor') are restricted to read-only operations
 * Admins (userRole === 'admin') have full access
 * Unauthenticated users are handled by loginEnabled setting
 */
export const roleBasedAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // If user is Admin, allow all requests
  if (req.user?.role === "admin") {
    next();
    return;
  }

  // If user is Visitor, restrict to read-only
  if (req.user?.role === "visitor") {
    // Allow GET requests (read-only)
    if (req.method === "GET") {
      next();
      return;
    }

    // Allow authentication-related POST requests
    if (req.method === "POST") {
      // Allow verify-password requests
      if (
        req.path.includes("/verify-password") ||
        req.url.includes("/verify-password")
      ) {
        next();
        return;
      }

      // Allow passkey authentication
      if (
        req.path.includes("/settings/passkeys/authenticate") ||
        req.url.includes("/settings/passkeys/authenticate")
      ) {
        next();
        return;
      }
    }

    // Block all other write operations (POST, PUT, DELETE, PATCH)
    res.status(403).json({
      success: false,
      error: "Visitor role: Write operations are not allowed. Read-only access only.",
    });
    return;
  }

  // For unauthenticated users, allow the request to proceed
  // (loginEnabled check and other auth logic will handle it)
  next();
};
