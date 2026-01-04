import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

const JWT_SECRET = process.env.JWT_SECRET || "default_development_secret_do_not_use_in_production";
const JWT_EXPIRES_IN = "24h";

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
