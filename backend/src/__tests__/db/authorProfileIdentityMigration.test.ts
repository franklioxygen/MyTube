import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { expect, it } from "vitest";

it("creates author profiles with optional artwork in a single migration", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.pragma("foreign_keys = ON");
    const migrations = path.resolve(__dirname, "../../../drizzle");
    const apply = sqlite.transaction(() => sqlite.exec(fs.readFileSync(path.join(migrations, "0031_author_profiles.sql"), "utf8")));
    apply();
    const author = ` ${"作".repeat(201)} `;
    sqlite.prepare("INSERT INTO author_profiles VALUES (?, ?, ?)").run(author, "/avatars/custom-aaaa.jpg", 123);
    sqlite.prepare("INSERT INTO author_profiles VALUES (?, NULL, ?)").run("identity only", 456);
    expect(sqlite.prepare("SELECT * FROM author_profiles").all()).toEqual([
      { author, custom_avatar_path: "/avatars/custom-aaaa.jpg", updated_at: 123 },
      { author: "identity only", custom_avatar_path: null, updated_at: 456 },
    ]);
    sqlite.prepare("UPDATE author_profiles SET custom_avatar_path = NULL WHERE author = ?").run(author);
    expect(sqlite.prepare("SELECT author, custom_avatar_path FROM author_profiles").all()).toEqual([
      { author, custom_avatar_path: null },
      { author: "identity only", custom_avatar_path: null },
    ]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  } finally { sqlite.close(); }
});
