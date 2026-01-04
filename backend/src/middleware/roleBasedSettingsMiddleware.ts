import { NextFunction, Request, Response } from "express";

/**
 * Middleware specifically for settings routes with role-based access control
 * Visitors can only read settings and update CloudFlare tunnel settings
 * Admins have full access to all settings
 */
export const roleBasedSettingsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // If user is Admin, allow all requests
  if (req.user?.role === "admin") {
    next();
    return;
  }

  // If user is Visitor, restrict to read-only and CloudFlare updates
  if (req.user?.role === "visitor") {
    // Allow GET requests (read-only)
    if (req.method === "GET") {
      next();
      return;
    }

    // For POST requests, check if it's authentication or CloudFlare settings
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
        req.path.includes("/passkeys/authenticate") ||
        req.url.includes("/passkeys/authenticate")
      ) {
        next();
        return;
      }

      const body = req.body || {};

      // Allow CloudFlare tunnel settings updates (read-only access mechanism)
      const isOnlyCloudflareUpdate =
        (body.cloudflaredTunnelEnabled !== undefined ||
          body.cloudflaredToken !== undefined) &&
        Object.keys(body).every(
          (key) =>
            key === "cloudflaredTunnelEnabled" ||
            key === "cloudflaredToken"
        );

      if (isOnlyCloudflareUpdate) {
        // Allow CloudFlare settings updates
        next();
        return;
      }

      // Block all other settings updates
      res.status(403).json({
        success: false,
        error:
          "Visitor role: Only reading settings and updating CloudFlare settings is allowed.",
      });
      return;
    }

    // Block all other write operations (PUT, DELETE, PATCH)
    res.status(403).json({
      success: false,
      error: "Visitor role: Write operations are not allowed.",
    });
    return;
  }

  // For unauthenticated users, allow the request to proceed
  // (loginEnabled check and other auth logic will handle it)
  next();
};
