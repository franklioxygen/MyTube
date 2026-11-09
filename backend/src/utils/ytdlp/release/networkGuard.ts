import fs from "node:fs";
import path from "node:path";
import type { YtDlpRelease } from "./types";

/** One process, original CLI/config parser, original proxy/DNS implementation. */
export function guardedYtDlpCommand(release: YtDlpRelease, args: readonly string[]): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (process.platform !== "linux") throw new Error("SSRF protection: guarded downloads require Linux; use the Docker image on this platform");
  const directory = [path.resolve(process.cwd(), "scripts"), path.resolve(__dirname, "../../../../scripts"), path.resolve(__dirname, "../../../../../scripts")]
    .find(candidate => fs.existsSync(path.join(candidate, "network-guard.py")) && fs.existsSync(path.join(candidate, "network-guard.so")));
  if (!directory) throw new Error("SSRF protection: connection guard is missing; build the backend before downloading");
  const library = path.join(directory, "network-guard.so");
  let command = release.command, mode = "module", entry = "yt_dlp", prefix: string[] = [];
  if (release.kind !== "managed") {
    const filename = /[/\\]/.test(command) ? path.resolve(command) : (release.spawnEnv.PATH || "").split(path.delimiter)
      .map(dir => path.resolve(dir, command)).find(candidate => fs.existsSync(candidate));
    if (!filename) throw new Error("SSRF protection: yt-dlp executable was not found");
    const descriptor = fs.openSync(filename, "r"), buffer = Buffer.alloc(512);
    let header: string;
    try { header = buffer.subarray(0, fs.readSync(descriptor, buffer, 0, buffer.length, 0)).toString("utf8"); }
    finally { fs.closeSync(descriptor); }
    const line = header.split(/\r?\n/, 1)[0];
    const words = line.startsWith("#!") ? line.slice(2).trim().split(/\s+/) : [];
    if (path.basename(words[0] || "") === "env") { words.shift(); if (words[0] === "-S") words.shift(); }
    command = words.shift() || "";
    if (!/^(?:python|pypy)(?:\d+(?:\.\d+)*)?$/i.test(path.basename(command)) || words.some(word => !/^(?:-s|-B|-E|-O|-OO|-u)$/.test(word))) {
      throw new Error("SSRF protection: use a managed release or a standard Python/zipapp yt-dlp entry point; opaque/frozen executables cannot be guarded");
    }
    prefix = words; entry = filename; mode = header.slice(header.indexOf("\n") + 1).startsWith("PK\x03\x04") ? "zip" : "script";
  } else if (release.prefixArgs[0] !== "-m" || release.prefixArgs[1] !== "yt_dlp") {
    throw new Error("SSRF protection: unsupported managed entry point");
  }
  return {
    command,
    args: [...prefix, path.join(directory, "network-guard.py"), mode, entry,
      ...(release.kind === "managed" ? release.prefixArgs.slice(2) : release.prefixArgs), ...args],
    env: { ...release.spawnEnv, MYTUBE_NETWORK_LIBRARY: library, MYTUBE_NETWORK_PROXIES: "",
      LD_PRELOAD: [library, release.spawnEnv.LD_PRELOAD].filter(Boolean).join(":") },
  };
}
