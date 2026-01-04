import { Response } from "express";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

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
  // SameSite=Strict provides CSRF protection
  // Secure flag should be set in production (HTTPS only)
  const isProduction = process.env.NODE_ENV === "production";
  const isSecure = process.env.SECURE_COOKIES === "true" || isProduction;
  
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, // Not accessible to JavaScript
    secure: isSecure, // Only sent over HTTPS in production
    sameSite: "strict", // CSRF protection
    maxAge: maxAge, // 24 hours
    path: "/", // Available for all paths
  });
  
  // Also set role in a separate cookie (non-HTTP-only for frontend to read)
  res.cookie("mytube_role", role, {
    httpOnly: false, // Frontend needs to read this
    secure: isSecure,
    sameSite: "strict",
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
    secure: process.env.SECURE_COOKIES === "true" || process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  res.clearCookie("mytube_role", {
    httpOnly: false,
    secure: process.env.SECURE_COOKIES === "true" || process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
};

/**
 * Get cookie name for authentication token
 */
export const getAuthCookieName = (): string => {
  return COOKIE_NAME;
};
