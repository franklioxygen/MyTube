#!/usr/bin/env ts-node

/**
 * Script to directly reset password and enable password login in the database
 * 
 * Usage:
 *   npm run reset-password [new-password]
 *   or
 *   ts-node scripts/reset-password.ts [new-password]
 * 
 * If no password is provided, a random 8-character password will be generated.
 * The script will:
 *   1. Hash the password using bcrypt
 *   2. Update the password in the settings table
 *   3. Set passwordLoginAllowed to true
 *   4. Set loginEnabled to true
 *   5. Display the new password (if generated)
 * 
 * Examples:
 *   npm run reset-password                    # Generate random password
 *   npm run reset-password mynewpassword123   # Set specific password
 */

import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Determine database path
const ROOT_DIR = process.cwd();
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, "data");
// Normalize and resolve paths to prevent path traversal
const normalizedDataDir = path.normalize(path.resolve(DATA_DIR));
const dbPath = path.normalize(path.resolve(normalizedDataDir, "mytube.db"));

// Validate that the database path is within the expected directory
// This prevents path traversal attacks via environment variables
const resolvedDataDir = path.resolve(normalizedDataDir);
const resolvedDbPath = path.resolve(dbPath);
if (!resolvedDbPath.startsWith(resolvedDataDir + path.sep) && resolvedDbPath !== resolvedDataDir) {
  console.error("Error: Invalid database path detected (path traversal attempt)");
  process.exit(1);
}

/**
 * Configure SQLite database for compatibility
 */
function configureDatabase(db: Database.Database): void {
  db.pragma("journal_mode = DELETE");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
}

/**
 * Generate a random password
 */
function generateRandomPassword(length: number = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = crypto.randomBytes(length);
  return Array.from(randomBytes, (byte) => chars.charAt(byte % chars.length)).join("");
}

/**
 * Hash a password using bcrypt
 */
async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

/**
 * Main function to reset password and enable password login
 */
async function resetPassword(newPassword?: string): Promise<void> {
  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.error(`Error: Database not found at ${dbPath}`);
    console.error("Please ensure the MyTube backend has been started at least once.");
    process.exit(1);
  }

  // Generate password if not provided
  const password = newPassword || generateRandomPassword(8);
  const isGenerated = !newPassword;

  // Hash the password
  console.log("Hashing password...");
  const hashedPassword = await hashPassword(password);

  // Connect to database
  console.log(`Connecting to database at ${dbPath}...`);
  const db = new Database(dbPath);
  configureDatabase(db);

  try {
    // Start transaction
    db.transaction(() => {
      // Update password
      db.prepare(`
        INSERT INTO settings (key, value)
        VALUES ('password', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify(hashedPassword));

      // Set passwordLoginAllowed to true
      db.prepare(`
        INSERT INTO settings (key, value)
        VALUES ('passwordLoginAllowed', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify(true));

      // Set loginEnabled to true
      db.prepare(`
        INSERT INTO settings (key, value)
        VALUES ('loginEnabled', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify(true));
    })();

    console.log("✓ Password reset successfully");
    console.log("✓ Password login enabled");
    console.log("✓ Login enabled");

    if (isGenerated) {
      console.log("\n" + "=".repeat(50));
      console.log("NEW PASSWORD (save this securely):");
      console.log(password);
      console.log("=".repeat(50));
      console.log("\n⚠️  This password will not be shown again!");
    } else {
      console.log("\n✓ Password has been set to the provided value");
    }
  } catch (error) {
    console.error("Error updating database:", error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const providedPassword = args[0];

// Run the script
resetPassword(providedPassword).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
