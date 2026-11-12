import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { expect, it } from "vitest";

it("migrates existing author profiles without losing their keys, artwork, or timestamps", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.pragma("foreign_keys = ON");
    const migrations = path.resolve(__dirname, "../../../drizzle");
    sqlite.exec(fs.readFileSync(path.join(migrations, "0031_author_profiles.sql"), "utf8"));
    const author = ` ${"作".repeat(201)} `;
    sqlite.prepare("INSERT INTO author_profiles VALUES (?, ?, ?)").run(author, "/avatars/custom-aaaa.jpg", 123);
    const apply = sqlite.transaction(() => sqlite.exec(fs.readFileSync(path.join(migrations, "0032_author_profile_identity.sql"), "utf8")));
    apply();
    expect(sqlite.prepare("SELECT * FROM author_profiles").all()).toEqual([
      { author, custom_avatar_path: "/avatars/custom-aaaa.jpg", updated_at: 123 },
    ]);
    sqlite.prepare("UPDATE author_profiles SET custom_avatar_path = NULL WHERE author = ?").run(author);
    expect(sqlite.prepare("SELECT author, custom_avatar_path FROM author_profiles").all()).toEqual([
      { author, custom_avatar_path: null },
    ]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  } finally { sqlite.close(); }
});
