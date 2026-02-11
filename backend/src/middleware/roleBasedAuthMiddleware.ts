import { NextFunction, Request, Response } from "express";
import { isLoginRequired } from "../services/passwordService";

/**
 * Check if the current request is to a public endpoint that doesn't require authentication
 */
const isPublicEndpoint = (req: Request): boolean => {
  const path = req.path || req.url || "";

  // Allow password verification endpoints (for login)
  if (
    path.includes("/verify-password") ||
    path.includes("/verify-admin-password") ||
    path.includes("/verify-visitor-password")
  ) {
    return true;
  }

  // Allow passkey authentication endpoints (for login)
  if (
    path.includes("/passkeys/authenticate") ||
    path.includes("/passkeys/register")
  ) {
    return true;
  }

  // Allow password-related endpoints that are needed for authentication
  if (
    path.includes("/password-enabled") ||
    path.includes("/reset-password-cooldown") ||
    path.includes("/reset-password")
  ) {
    return true;
  }

  // Allow logout endpoint (can be called without auth)
  if (path.includes("/logout")) {
    return true;
  }

  return false;
};

/**
 * Middleware to enforce role-based access control
 * Visitors (userRole === 'visitor') are restricted to read-only operations
 * Admins (userRole === 'admin') have full access
 * Unauthenticated users are blocked when loginEnabled is true (except for public endpoints)
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
      // Allow verify-password requests (including verify-admin-password and verify-visitor-password)
      if (
        req.path.includes("/verify-password") ||
        req.url.includes("/verify-password") ||
        req.path.includes("/verify-admin-password") ||
        req.url.includes("/verify-admin-password") ||
        req.path.includes("/verify-visitor-password") ||
        req.url.includes("/verify-visitor-password")
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

      // Allow logout endpoint
      if (req.path.includes("/logout") || req.url.includes("/logout")) {
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

  // For unauthenticated users, check if login is required
  if (!req.user) {
    const loginRequired = isLoginRequired();

    // If login is required and this is not a public endpoint, reject the request
    if (loginRequired && !isPublicEndpoint(req)) {
      res.status(401).json({
        success: false,
        error: "Authentication required. Please log in to access this resource.",
      });
      return;
    }

    // If login is not required, or this is a public endpoint, allow the request
    next();
    return;
  }

  // Fallback: allow the request (should not reach here)
  next();
};
