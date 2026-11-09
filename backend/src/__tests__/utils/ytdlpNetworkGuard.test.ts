import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guardedYtDlpCommand } from "../../utils/ytdlp/release/networkGuard";
import type { YtDlpRelease } from "../../utils/ytdlp/release/types";

let directory: string, executable: string;
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "linux" });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-launch-")); executable = path.join(directory, "yt-dlp");
  fs.writeFileSync(executable, "#!/usr/bin/env python3\nfrom yt_dlp import main\nmain()\n");
  const exists = fs.existsSync;
  vi.spyOn(fs, "existsSync").mockImplementation(filename => String(filename).endsWith("network-guard.so") || exists(filename));
});
afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(process, "platform", platform); fs.rmSync(directory, { recursive: true, force: true }); });
const release = (changes = {}) => ({
  kind: "external", command: executable, prefixArgs: [],
  spawnEnv: { PATH: directory, PYTHONPATH: "/admin/packages", LD_PRELOAD: "/admin/existing.so", NO_PROXY: "example.com:80,example.com:443" },
  ...changes,
}) as unknown as YtDlpRelease;

it("runs the original Python entry in one process, retaining native arguments and proxy environment", () => {
  const args = ["--config-locations", "nested.conf", "--my-alias", "value", "--", "https://example.com/video"];
  const result = guardedYtDlpCommand(release(), args);
  expect(result.command).toBe("python3");
  expect(result.args.slice(-args.length)).toEqual(args);
  expect(result.args).toContain("script"); expect(result.args).toContain(executable);
  expect(result.args).not.toContain("--proxy"); expect(result.args).not.toContain("--ignore-config");
  expect(result.env.NO_PROXY).toBe("example.com:80,example.com:443");
  expect(result.env.PYTHONPATH).toBe("/admin/packages"); expect(result.env.LD_PRELOAD).toContain(":/admin/existing.so");
});
it("preserves the managed Python/module path and CLI prefix", () => {
  const result = guardedYtDlpCommand(release({ kind: "managed", command: "/runtime/python3", prefixArgs: ["-m", "yt_dlp", "--plugin-dirs", "/admin/plugins"] }), ["--", "https://example.com"]);
  expect(result.command).toBe("/runtime/python3");
  expect(result.args.slice(1)).toEqual(["module", "yt_dlp", "--plugin-dirs", "/admin/plugins", "--", "https://example.com"]);
});
it.each(["\n", "\r\n"])("retains the original zipapp's import path with %j newlines", newline => {
  fs.writeFileSync(executable, `#!/usr/bin/env python3${newline}PK\x03\x04`);
  expect(guardedYtDlpCommand(release(), []).args[1]).toBe("zip");
});
it.each(["#!/bin/sh\nexec yt-dlp", "MZ-frozen", "\x7fELF-frozen", "#!/usr/bin/env python3 -I\n"])("fails explicitly for an unsupported entry point %j", contents => {
  fs.writeFileSync(executable, contents);
  expect(() => guardedYtDlpCommand(release(), [])).toThrow(/cannot be guarded/);
});
it.each(["darwin", "win32"])("fails explicitly on %s instead of running unprotected", value => {
  Object.defineProperty(process, "platform", { value });
  expect(() => guardedYtDlpCommand(release(), [])).toThrow("Docker image");
});
it("does not start a command when the library is missing", () => {
  vi.mocked(fs.existsSync).mockReturnValue(false);
  expect(() => guardedYtDlpCommand(release(), [])).toThrow("build the backend");
});
