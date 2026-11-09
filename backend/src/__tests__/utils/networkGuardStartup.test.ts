import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

// Exercise npm's actual lifecycle from a clean checkout; stub only the long-lived server.
it.skipIf(process.platform !== "linux").each(["start", "dev"])("builds the missing guard before npm run %s starts the server", command => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-startup-"));
  try {
    const backend = path.resolve(__dirname, "../../..");
    const scripts = JSON.parse(fs.readFileSync(path.join(backend, "package.json"), "utf8")).scripts;
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ scripts }));
    fs.mkdirSync(path.join(directory, "scripts"));
    for (const file of ["build-network-guard.cjs", "network-guard.c"]) {
      fs.copyFileSync(path.join(backend, "scripts", file), path.join(directory, "scripts", file));
    }
    const bin = path.join(directory, "node_modules", ".bin");
    fs.mkdirSync(bin, { recursive: true });
    for (const file of ["ts-node", "nodemon"]) {
      fs.writeFileSync(path.join(bin, file), `#!/usr/bin/env node\nconst fs = require('node:fs');
if (fs.readFileSync('scripts/network-guard.so').subarray(0, 4).toString() !== '\\x7fELF') process.exit(1);
console.log('guard-ready');\n`, { mode: 0o755 });
    }
    expect(fs.existsSync(path.join(directory, "scripts", "network-guard.so"))).toBe(false);
    const output = execFileSync("npm", ["run", command], {
      cwd: directory, env: process.env, encoding: "utf8", timeout: 20000,
    });
    expect(output).toContain("guard-ready");
    // An already-built deployment can start without a compiler installed.
    expect(execFileSync("npm", ["run", command], {
      cwd: directory, env: { ...process.env, CC: "/missing/compiler" }, encoding: "utf8", timeout: 20000,
    })).toContain("guard-ready");
    // Stale artifacts must be rebuilt, and a failed build must prevent startup.
    fs.utimesSync(path.join(directory, "scripts", "network-guard.so"), 0, 0);
    expect(() => execFileSync("npm", ["run", command], {
      cwd: directory, env: { ...process.env, CC: "/missing/compiler" }, stdio: "pipe", timeout: 20000,
    })).toThrow();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
