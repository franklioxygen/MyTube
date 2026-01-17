import { Response } from "express";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

// Warn if JWT_SECRET is not set in production
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  console.error("WARNING: JWT_SECRET is not set in production environment. This is a security risk!");
}

const JWT_SECRET = process.env.JWT_SECRET || "default_development_secret_do_not_use_in_production";
const JWT_EXPIRES_IN = "24h";
const COOKIE_NAME = "mytube_auth_token";

export interface UserPayload {
  role: "admin" | "visitor";
  id?: string;
}

/**
 * Generate a JWT token for a user
 */
export const generateToken = (payload: UserPayload): string => {
  return jwt.sign({ ...payload, id: payload.id || uuidv4() }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

/**
 * Verify a JWT token
 */
export const verifyToken = (token: string): UserPayload | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as UserPayload;
    return decoded;
  } catch (error) {
    return null;
  }
};

/**
 * Set HTTP-only cookie with authentication token
 * This is more secure than storing tokens in localStorage as it's not accessible to JavaScript
 */
export const setAuthCookie = (res: Response, token: string, role: "admin" | "visitor"): void => {
  // Calculate expiration time (24 hours in milliseconds)
  const maxAge = 24 * 60 * 60 * 1000;
  
  // Set HTTP-only cookie (not accessible to JavaScript, preventing XSS attacks)
  // SameSite=Lax allows for better usability while maintaining CSRF protection
  // Secure flag is optional (env var) to allow potential HTTP usage in private networks
  // Note: The token is a JWT (JSON Web Token) which is designed to be transmitted and stored.
  // JWT tokens are signed and contain user role information, but are not considered sensitive
  // in the same way as passwords. Passwords are hashed using bcrypt and never stored in plain text.
  const isSecure = process.env.SECURE_COOKIES === "true";
  
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, // Not accessible to JavaScript, preventing XSS attacks
    secure: isSecure, // Only sent over HTTPS if explicitly configured
    sameSite: "lax", // Better persistence across navigations
    maxAge: maxAge, // 24 hours
    path: "/", // Available for all paths
  });
  
  // Also set role in a separate cookie (non-HTTP-only for frontend to read)
  // Note: This cookie is not sensitive (only contains role: "admin" or "visitor")
  // and is needed by the frontend for UI rendering. The role value is not sensitive data.
  res.cookie("mytube_role", role, {
    httpOnly: false, // Frontend needs to read this for UI rendering
    secure: isSecure,
    sameSite: "lax",
    maxAge: maxAge,
    path: "/",
  });
};

/**
 * Clear authentication cookies
 */
export const clearAuthCookie = (res: Response): void => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.SECURE_COOKIES === "true",
    sameSite: "lax",
    path: "/",
  });
  res.clearCookie("mytube_role", {
    httpOnly: false,
    secure: process.env.SECURE_COOKIES === "true",
    sameSite: "lax",
    path: "/",
  });
};

/**
 * Get cookie name for authentication token
 */
export const getAuthCookieName = (): string => {
  return COOKIE_NAME;
};
