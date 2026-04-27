import { spawn } from "child_process";
import { EventEmitter } from "events";
import fs from "fs-extra";
import path from "path";
import { PassThrough } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storageService from "../../services/storageService";
import { getProviderScript } from "../../services/downloaders/ytdlp/ytdlpHelpers";
import {
  InvalidProxyError,
  convertFlagToArg,
  downloadChannelAvatar,
  ensureYtDlpAvailable,
  executeYtDlpJson,
  executeYtDlpSpawn,
  flagsToArgs,
  getAxiosProxyConfig,
  getChannelUrlFromVideo,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  parseYtDlpConfig,
  resetYtDlpAvailabilityCacheForTests,
} from "../../utils/ytDlpUtils";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));
vi.mock("fs-extra");
vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
}));
vi.mock("../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderScript: vi.fn(),
}));
vi.mock("socks-proxy-agent", () => ({
  SocksProxyAgent: vi.fn().mockImplementation((url: string) => ({
    kind: "socks-agent",
    url,
  })),
}));

type MockProcess = EventEmitter & {
  stdout: PassThrough | null;
  stderr: PassThrough | null;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
};

type JsRuntimeFlagStyle = "plural" | "singular" | "none";

const createMockProcess = (): MockProcess => {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.killed = false;
  proc.kill = vi.fn((signal?: NodeJS.Signals) => {
    proc.killed = true;
    return Boolean(signal || true);
  });
  return proc;
};

const createVersionCheckProcess = (): MockProcess => {
  const proc = createMockProcess();
  queueMicrotask(() => proc.emit("close", 0));
  return proc;
};

const createDenoCheckProcess = (available: boolean = true): MockProcess => {
  const proc = createMockProcess();
  queueMicrotask(() => proc.emit("close", available ? 0 : 1));
  return proc;
};

const createHelpCheckProcess = (flagStyle: JsRuntimeFlagStyle = "plural"): MockProcess => {
  const proc = createMockProcess();
  queueMicrotask(() => {
    const helpText =
      flagStyle === "plural"
        ? "    --js-runtimes RUNTIME[:PATH]\n"
        : flagStyle === "singular"
          ? "    --js-runtime RUNTIME[:PATH]\n"
        : "";
    proc.stdout?.emit("data", Buffer.from(helpText));
    proc.emit("close", 0);
  });
  return proc;
};

const mockSpawnWithVersionCheck = (...processes: MockProcess[]) => {
  vi.mocked(spawn).mockImplementationOnce(() => createVersionCheckProcess() as any);
  for (const proc of processes) {
    vi.mocked(spawn).mockImplementationOnce(() => proc as any);
  }
};

const mockSpawnWithVersionAndHelpCheck = (
  flagStyle: JsRuntimeFlagStyle = "plural",
  ...processes: MockProcess[]
) => {
  vi.mocked(spawn).mockImplementationOnce(() => createVersionCheckProcess() as any);
  vi.mocked(spawn).mockImplementationOnce(() => createHelpCheckProcess(flagStyle) as any);
  for (const proc of processes) {
    vi.mocked(spawn).mockImplementationOnce(() => proc as any);
  }
};

const mockSpawnWithVersionHelpAndDenoCheck = (
  flagStyle: JsRuntimeFlagStyle = "plural",
  ...processes: MockProcess[]
) => {
  vi.mocked(spawn).mockImplementationOnce(() => createVersionCheckProcess() as any);
  vi.mocked(spawn).mockImplementationOnce(() => createHelpCheckProcess(flagStyle) as any);
  vi.mocked(spawn).mockImplementationOnce(() => createDenoCheckProcess() as any);
  for (const proc of processes) {
    vi.mocked(spawn).mockImplementationOnce(() => proc as any);
  }
};

const flushAsyncSpawns = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

const getSpawnArgsForUrl = (url: string, occurrence: number = 0): string[] => {
  const matchingCalls = vi.mocked(spawn).mock.calls.filter(([, args]) =>
    Array.isArray(args) && args.includes(url)
  );
  const call = matchingCalls[occurrence];
  if (!call) {
    throw new Error(`Expected spawn call for ${url}`);
  }
  return call[1] as string[];
};

const createMissingFileError = (): NodeJS.ErrnoException =>
  Object.assign(new Error("File not found"), { code: "ENOENT" });

const validNetscapeCookies =
  "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tf4=4000000\n";

describe("ytDlpUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetYtDlpAvailabilityCacheForTests();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue(validNetscapeCookies);
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw createMissingFileError();
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(storageService.getSettings).mockReturnValue({});
    vi.mocked(getProviderScript).mockReturnValue("");
    delete process.env.YT_DLP_JS_RUNTIME;
  });

  describe("convertFlagToArg", () => {
    it("should convert camelCase to kebab-case", () => {
      expect(convertFlagToArg("minSleepInterval")).toBe("--min-sleep-interval");
    });

    it("should handle single letters", () => {
      expect(convertFlagToArg("f")).toBe("--f");
    });
  });

  describe("flagsToArgs", () => {
    it("should convert mixed flags object to args array", () => {
      const flags = {
        format: "best",
        verbose: true,
        output: "out.mp4",
        headers: ["a", "b"],
      };
      const args = flagsToArgs(flags);

      expect(args).toContain("--format");
      expect(args).toContain("best");
      expect(args).toContain("--verbose");
      expect(args).toContain("--output");
      expect(args).toContain("out.mp4");
      expect(args).toContain("--headers");
      expect(args).toContain("a,b");
    });

    it("should handle extractorArgs and addHeader special keys", () => {
      const args = flagsToArgs({
        extractorArgs: "youtube:key=value;generic:abc=def",
        addHeader: ["X-Test:1", "X-Token:abc"],
      });

      expect(args).toEqual([
        "--extractor-args",
        "youtube:key=value;generic:abc=def",
        "--add-header",
        "X-Test:1",
        "--add-header",
        "X-Token:abc",
      ]);
    });

    it("should map short options to long options", () => {
      const args = flagsToArgs({ f: "best", S: "res:2160", R: 3, N: 8 });
      expect(args).toEqual([
        "--format",
        "best",
        "--format-sort",
        "res:2160",
        "--retries",
        "3",
        "--concurrent-fragments",
        "8",
      ]);
    });

    it("should skip nullish and false boolean flags", () => {
      const args = flagsToArgs({
        verbose: false,
        proxy: null,
        socketTimeout: undefined,
      });
      expect(args).toEqual([]);
    });
  });

  describe("parseYtDlpConfig", () => {
    it("should parse long options, quoted values and booleans", () => {
      const config = `
        # comment
        --format "bestvideo+bestaudio"
        --output '%(title)s.%(ext)s'
        --no-mtime
      `;

      const parsed = parseYtDlpConfig(config);
      expect(parsed).toEqual({
        format: "bestvideo+bestaudio",
        output: "%(title)s.%(ext)s",
        noMtime: true,
      });
    });

    it("should parse short options", () => {
      const parsed = parseYtDlpConfig("-f best\n-S res:2160\n-R 5\n-x");
      expect(parsed).toEqual({
        f: "best",
        S: "res:2160",
        R: "5",
        x: true,
      });
    });

    it("should return empty object for empty input", () => {
      expect(parseYtDlpConfig("")).toEqual({});
      expect(parseYtDlpConfig(undefined as unknown as string)).toEqual({});
    });
  });

  describe("getUserYtDlpConfig", () => {
    const originalTrustLevel = process.env.MYTUBE_ADMIN_TRUST_LEVEL;

    afterEach(() => {
      if (originalTrustLevel === undefined) {
        delete process.env.MYTUBE_ADMIN_TRUST_LEVEL;
      } else {
        process.env.MYTUBE_ADMIN_TRUST_LEVEL = originalTrustLevel;
      }
    });

    it("should parse user config from settings", () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ytDlpConfig: "--format best\n--proxy http://127.0.0.1:7890",
      } as any);

      const parsed = getUserYtDlpConfig();
      expect(parsed).toEqual({
        format: "best",
        proxy: "http://127.0.0.1:7890",
      });
    });

    it("should remove proxy for non-youtube urls when proxyOnlyYoutube is enabled", () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ytDlpConfig: "--format best\n--proxy http://127.0.0.1:7890",
        proxyOnlyYoutube: true,
      } as any);

      const parsed = getUserYtDlpConfig("https://www.bilibili.com/video/BV123");
      expect(parsed.format).toBe("best");
      expect(parsed.proxy).toBeUndefined();
    });

    it("should keep proxy for youtube urls when proxyOnlyYoutube is enabled", () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        ytDlpConfig: "--proxy http://127.0.0.1:7890",
        proxyOnlyYoutube: true,
      } as any);

      const parsed = getUserYtDlpConfig("https://www.youtube.com/watch?v=abc");
      expect(parsed.proxy).toBe("http://127.0.0.1:7890");
    });

    it("should return empty config when storage read fails", () => {
      vi.mocked(storageService.getSettings).mockImplementation(() => {
        throw new Error("settings read error");
      });

      expect(getUserYtDlpConfig()).toEqual({});
    });

    it("should ignore raw config when deployment trust is application", () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = "application";
      vi.mocked(storageService.getSettings).mockReturnValue({
        ytDlpConfig: "--exec echo hi",
      } as any);

      expect(getUserYtDlpConfig()).toEqual({});
    });
  });

  describe("getNetworkConfigFromUserConfig", () => {
    it("should extract only network related options", () => {
      const cfg = getNetworkConfigFromUserConfig({
        proxy: "http://127.0.0.1:7890",
        r: "1M",
        socketTimeout: 30,
        forceIpv4: true,
        xff: "CN",
        sleepRequests: 1,
        minSleepInterval: 2,
        maxSleepInterval: 5,
        R: 4,
        format: "bestvideo",
      });

      expect(cfg).toEqual({
        proxy: "http://127.0.0.1:7890",
        limitRate: "1M",
        socketTimeout: 30,
        forceIpv4: true,
        xff: "CN",
        sleepRequests: 1,
        sleepInterval: 2,
        maxSleepInterval: 5,
        retries: 4,
      });
      expect((cfg as any).format).toBeUndefined();
    });
  });

  describe("getAxiosProxyConfig", () => {
    it("should build http proxy config with auth", () => {
      const cfg = getAxiosProxyConfig("http://user:pass@proxy.example.com:8080");
      expect(cfg).toEqual({
        proxy: {
          protocol: "http",
          host: "proxy.example.com",
          port: 8080,
          auth: {
            username: "user",
            password: "pass",
          },
        },
      });
    });

    it("should use default https port when not provided", () => {
      const cfg = getAxiosProxyConfig("https://proxy.example.com");
      expect(cfg).toEqual({
        proxy: {
          protocol: "https",
          host: "proxy.example.com",
          port: 443,
        },
      });
    });

    it("should convert socks5 to socks5h and return custom agent config", () => {
      const cfg = getAxiosProxyConfig("socks5://127.0.0.1:1080");
      expect(cfg.proxy).toBe(false);
      expect(cfg.httpAgent).toMatchObject({
        kind: "socks-agent",
        url: "socks5h://127.0.0.1:1080",
      });
      expect(cfg.httpsAgent).toEqual(cfg.httpAgent);
    });

    it("should throw InvalidProxyError on malformed url", () => {
      expect(() => getAxiosProxyConfig("://bad")).toThrow(InvalidProxyError);
    });

    it("should throw InvalidProxyError on unsupported protocol", () => {
      expect(() => getAxiosProxyConfig("ftp://proxy.example.com:21")).toThrow(
        InvalidProxyError
      );
    });

    it("should return empty config for empty proxy string", () => {
      expect(getAxiosProxyConfig("")).toEqual({});
    });
  });

  describe("ensureYtDlpAvailable", () => {
    it("should continue when --version exits non-zero", async () => {
      const versionProc = createMockProcess();
      vi.mocked(spawn).mockImplementationOnce(() => versionProc as any);

      const promise = ensureYtDlpAvailable();
      versionProc.emit("close", 1);

      await expect(promise).resolves.toBeUndefined();
      expect(vi.mocked(spawn).mock.calls).toHaveLength(1);
    });

    it("should auto-install when yt-dlp is missing", async () => {
      const versionProc = createMockProcess();
      const installProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => versionProc as any)
        .mockImplementationOnce(() => installProc as any);

      const promise = ensureYtDlpAvailable();
      versionProc.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));
      await flushAsyncSpawns();
      installProc.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
      expect(vi.mocked(spawn).mock.calls[1][1]).toEqual(["install", "yt-dlp"]);
    });

    it("should throw when yt-dlp exists but is not executable", async () => {
      const versionProc = createMockProcess();
      vi.mocked(spawn).mockImplementationOnce(() => versionProc as any);

      const promise = ensureYtDlpAvailable();
      versionProc.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" }));

      await expect(promise).rejects.toThrow("not executable");
    });

    it("should reset cache after failure so the next call retries", async () => {
      const failProc = createMockProcess();
      const successProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => failProc as any)
        .mockImplementationOnce(() => successProc as any);

      // First call: fails due to permissions error
      const firstPromise = ensureYtDlpAvailable();
      failProc.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" }));
      await expect(firstPromise).rejects.toThrow("not executable");

      // Second call: cache was reset, so a new version check is spawned and succeeds
      const secondPromise = ensureYtDlpAvailable();
      successProc.emit("close", 0);
      await expect(secondPromise).resolves.toBeUndefined();

      expect(vi.mocked(spawn).mock.calls).toHaveLength(2);
    });
  });

  describe("executeYtDlpJson", () => {
    it("should execute and parse json output with youtube runtime and cookies", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);
      vi.mocked(fs.existsSync).mockImplementation((target: any) =>
        String(target).endsWith(path.join("data", "cookies.txt"))
      );
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: 1,
        size: validNetscapeCookies.length,
      } as any);
      vi.mocked(fs.readFileSync).mockReturnValue(validNetscapeCookies);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc", {
        format: "best",
      });
      await flushAsyncSpawns();

      proc.stdout?.emit("data", Buffer.from('{"id":"abc","title":"video"}'));
      proc.stderr?.emit("data", Buffer.from("[info] metadata"));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({
        id: "abc",
        title: "video",
      });

      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).toContain("--dump-single-json");
      expect(args).toContain("--js-runtimes");
      expect(args).toContain("deno");
      expect(args).toContain("--cookies");
      expect(args.filter((arg) => arg === "--no-warnings")).toHaveLength(1);
    });

    it("should convert an existing Cookie header file before passing cookies", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);
      vi.mocked(fs.existsSync).mockImplementation((target: any) =>
        String(target).endsWith(path.join("data", "cookies.txt"))
      );
      const cookieHeader = "VISITOR_INFO1_LIVE=abc; PREF=f4=4000000";
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: 1,
        size: cookieHeader.length,
      } as any);
      vi.mocked(fs.readFileSync).mockReturnValue(cookieHeader);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();

      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("cookies.txt"),
        expect.stringContaining(
          ".youtube.com\tTRUE\t/\tFALSE\t0\tVISITOR_INFO1_LIVE\tabc"
        ),
        "utf8"
      );
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).toContain("--cookies");
    });

    it("should ignore unsupported existing cookies instead of passing them to yt-dlp", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);
      vi.mocked(fs.existsSync).mockImplementation((target: any) =>
        String(target).endsWith(path.join("data", "cookies.txt"))
      );
      const unsupportedContent = "cookie-data";
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: 1,
        size: unsupportedContent.length,
      } as any);
      vi.mocked(fs.readFileSync).mockReturnValue(unsupportedContent);

      const promise = executeYtDlpJson("https://example.com/video");
      await flushAsyncSpawns();

      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });

      const args = getSpawnArgsForUrl("https://example.com/video");
      expect(args).not.toContain("--cookies");
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should preprocess xvideos.red urls before spawning", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const promise = executeYtDlpJson("https://xvideos.red/video/123");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from("{}"));
      proc.emit("close", 0);
      await promise;

      const args = getSpawnArgsForUrl("https://xvideos.com/video/123");
      expect(args[args.length - 1]).toContain("xvideos.com/video/123");
    });

    it("should retry without format restrictions on format error", async () => {
      const first = createMockProcess();
      const second = createMockProcess();
      mockSpawnWithVersionCheck(first, second);

      const promise = executeYtDlpJson("https://example.com/video", {
        format: "best",
        formatSort: "res:2160",
      });
      await flushAsyncSpawns();

      first.stderr?.emit("data", Buffer.from("Requested format is not available"));
      first.emit("close", 1);
      await flushAsyncSpawns();
      second.stdout?.emit("data", Buffer.from('{"ok":true}'));
      second.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });

      const secondArgs = getSpawnArgsForUrl("https://example.com/video", 1);
      expect(secondArgs).not.toContain("--format");
      expect(secondArgs).not.toContain("--format-sort");
      expect(secondArgs).toContain("https://example.com/video");
    });

    it("should retry with --ignore-config when format error comes from config", async () => {
      const first = createMockProcess();
      const second = createMockProcess();
      mockSpawnWithVersionCheck(first, second);

      const promise = executeYtDlpJson("https://example.com/video", {});
      await flushAsyncSpawns();

      first.stderr?.emit("data", Buffer.from("No video formats found"));
      first.emit("close", 1);
      await flushAsyncSpawns();
      second.stdout?.emit("data", Buffer.from('{"fallback":true}'));
      second.emit("close", 0);

      await expect(promise).resolves.toEqual({ fallback: true });
      const secondArgs = getSpawnArgsForUrl("https://example.com/video", 1);
      expect(secondArgs).toContain("--ignore-config");
      expect(secondArgs).not.toContain("--format");
    });

    it("should add provider and mweb extractor args for youtube when bundled provider is available", async () => {
      vi.mocked(getProviderScript).mockReturnValue(
        "/app/bgutil-ytdlp-pot-provider/server/build/generate_once.js",
      );
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      const extractorArgsIndex = args.indexOf("--extractor-args");
      expect(extractorArgsIndex).toBeGreaterThan(-1);
      expect(args[extractorArgsIndex + 1]).toContain(
        "youtube:player_client=default,mweb",
      );
      expect(args[extractorArgsIndex + 1]).toContain(
        "youtubepot-bgutilscript:script_path=/app/bgutil-ytdlp-pot-provider/server/build/generate_once.js",
      );
    });

    it("should preserve existing youtube extractor args while appending provider support", async () => {
      vi.mocked(getProviderScript).mockReturnValue("/tmp/provider.js");
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc", {
        extractorArgs: "youtube:max_comments=20",
      });
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      const extractorArgsIndex = args.indexOf("--extractor-args");
      expect(extractorArgsIndex).toBeGreaterThan(-1);
      expect(args[extractorArgsIndex + 1]).toContain("youtube:max_comments=20");
      expect(args[extractorArgsIndex + 1]).toContain(
        "youtube:player_client=default,mweb",
      );
      expect(args[extractorArgsIndex + 1]).toContain(
        "youtubepot-bgutilscript:script_path=/tmp/provider.js",
      );
    });

    it("should not append duplicate player_client or provider extractor args", async () => {
      vi.mocked(getProviderScript).mockReturnValue("/tmp/provider.js");
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc", {
        extractorArgs:
          "youtube:player_client=android;youtubepot-bgutilscript:script_path=/custom/provider.js",
      });
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      const extractorArgsIndex = args.indexOf("--extractor-args");
      expect(extractorArgsIndex).toBeGreaterThan(-1);
      expect(args[extractorArgsIndex + 1]).toBe(
        "youtube:player_client=android;youtubepot-bgutilscript:script_path=/custom/provider.js",
      );
    });

    it("should normalize array extractorArgs into a single extractor-args value for youtube", async () => {
      vi.mocked(getProviderScript).mockReturnValue("/tmp/provider.js");
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc", {
        extractorArgs: ["youtube:max_comments=20", "generic:impersonate=safari"],
      });
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args.filter((arg) => arg === "--extractor-args")).toHaveLength(1);
      const extractorArgsIndex = args.indexOf("--extractor-args");
      expect(args[extractorArgsIndex + 1]).toBe(
        "youtube:max_comments=20;generic:impersonate=safari;youtube:player_client=default,mweb;youtubepot-bgutilscript:script_path=/tmp/provider.js",
      );
    });

    it("should reject with stderr on non-zero non-format error", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const promise = executeYtDlpJson("https://example.com/video");
      await flushAsyncSpawns();
      proc.stderr?.emit("data", Buffer.from("fatal error"));
      proc.emit("close", 2);

      await expect(promise).rejects.toMatchObject({
        message: "yt-dlp process exited with code 2",
        stderr: "fatal error",
      });
    });

    it("should reject when json parse fails", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const promise = executeYtDlpJson("https://example.com/video");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from("not-json"));
      proc.emit("close", 0);

      await expect(promise).rejects.toThrow("Failed to parse yt-dlp output as JSON");
    });

    it("should reject when subprocess emits error", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const promise = executeYtDlpJson("https://example.com/video");
      await flushAsyncSpawns();
      proc.emit("error", new Error("spawn failed"));

      await expect(promise).rejects.toThrow("spawn failed");
    });

    it("should use deno runtime when YT_DLP_JS_RUNTIME is set to deno", async () => {
      process.env.YT_DLP_JS_RUNTIME = "deno";
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).toContain("--js-runtimes");
      expect(args).toContain("deno");
      expect(args).not.toContain("node");
    });

    it("should use node runtime when YT_DLP_JS_RUNTIME is set to node", async () => {
      process.env.YT_DLP_JS_RUNTIME = "node";
      const proc = createMockProcess();
      mockSpawnWithVersionAndHelpCheck("plural", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).toContain("--js-runtimes");
      expect(args).toContain("node");
      expect(args).not.toContain("deno");
    });

    it("should use legacy singular js runtime flag when yt-dlp help exposes it", async () => {
      process.env.YT_DLP_JS_RUNTIME = "node";
      const proc = createMockProcess();
      mockSpawnWithVersionAndHelpCheck("singular", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).toContain("--js-runtime");
      expect(args).toContain("node");
      expect(args).not.toContain("--js-runtimes");
    });

    it("should skip js runtime args when yt-dlp help exposes neither runtime flag", async () => {
      process.env.YT_DLP_JS_RUNTIME = "deno";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const proc = createMockProcess();
      mockSpawnWithVersionAndHelpCheck("none", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).not.toContain("--js-runtime");
      expect(args).not.toContain("--js-runtimes");
      expect(args).not.toContain("deno");
      expect(args).not.toContain("node");
      expect(warnSpy).toHaveBeenCalledWith(
        "[yt-dlp] Current yt-dlp binary does not support --js-runtimes. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
      );
      warnSpy.mockRestore();
    });

    it("should warn explicitly when YT_DLP_JS_RUNTIME=deno but deno is unavailable", async () => {
      process.env.YT_DLP_JS_RUNTIME = "deno";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const denoCheckProc = createMockProcess();
      const ytProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => createVersionCheckProcess() as any)
        .mockImplementationOnce(() => createHelpCheckProcess() as any)
        .mockImplementationOnce(() => denoCheckProc as any)
        .mockImplementationOnce(() => ytProc as any);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      denoCheckProc.emit(
        "error",
        Object.assign(new Error("not found"), { code: "ENOENT" })
      );
      await flushAsyncSpawns();
      ytProc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      ytProc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).toContain("--js-runtimes");
      expect(args).toContain("node");
      expect(warnSpy).toHaveBeenCalledWith(
        '[yt-dlp] YT_DLP_JS_RUNTIME is set to "deno", but Deno runtime is unavailable. Falling back to "node". Install Deno or set YT_DLP_JS_RUNTIME=node.'
      );
      warnSpy.mockRestore();
    });

    it("should fall back to deno runtime when YT_DLP_JS_RUNTIME is invalid", async () => {
      process.env.YT_DLP_JS_RUNTIME = "BUN";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).toContain("--js-runtimes");
      expect(args).toContain("deno");
      expect(warnSpy).toHaveBeenCalledWith(
        '[yt-dlp] Unsupported YT_DLP_JS_RUNTIME="BUN". Falling back to "deno".'
      );
      warnSpy.mockRestore();
    });

    it("should warn clearly when YT_DLP_JS_RUNTIME is invalid and deno is unavailable", async () => {
      process.env.YT_DLP_JS_RUNTIME = "BUN";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const denoCheckProc = createMockProcess();
      const ytProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => createVersionCheckProcess() as any)
        .mockImplementationOnce(() => createHelpCheckProcess() as any)
        .mockImplementationOnce(() => denoCheckProc as any)
        .mockImplementationOnce(() => ytProc as any);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      denoCheckProc.emit(
        "error",
        Object.assign(new Error("not found"), { code: "ENOENT" })
      );
      await flushAsyncSpawns();
      ytProc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      ytProc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).toContain("--js-runtimes");
      expect(args).toContain("node");
      expect(warnSpy).toHaveBeenCalledWith(
        '[yt-dlp] Unsupported YT_DLP_JS_RUNTIME="BUN". Falling back to "deno".'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[yt-dlp] YT_DLP_JS_RUNTIME="BUN" is unsupported and Deno runtime is unavailable. Falling back to "node". Install Deno or set YT_DLP_JS_RUNTIME=node.'
      );
      warnSpy.mockRestore();
    });

    it("should fall back to node when deno is unavailable by default", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const denoCheckProc = createMockProcess();
      const ytProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => createVersionCheckProcess() as any)
        .mockImplementationOnce(() => createHelpCheckProcess() as any)
        .mockImplementationOnce(() => denoCheckProc as any)
        .mockImplementationOnce(() => ytProc as any);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      denoCheckProc.emit(
        "error",
        Object.assign(new Error("not found"), { code: "ENOENT" })
      );
      await flushAsyncSpawns();
      ytProc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      ytProc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).toContain("--js-runtimes");
      expect(args).toContain("node");
      expect(warnSpy).toHaveBeenCalledWith(
        '[yt-dlp] Deno runtime is unavailable. Falling back to "node". Set YT_DLP_JS_RUNTIME=node to skip Deno checks.'
      );
      warnSpy.mockRestore();
    });
  });

  describe("getChannelUrlFromVideo", () => {
    it("should return trimmed channel url on success", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);

      const promise = getChannelUrlFromVideo("https://www.youtube.com/watch?v=abc", {
        proxy: "http://127.0.0.1:7890",
      });
      await flushAsyncSpawns();

      proc.stdout?.emit("data", Buffer.from("https://www.youtube.com/@channel\n"));
      proc.emit("close", 0);

      await expect(promise).resolves.toBe("https://www.youtube.com/@channel");

      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).toContain("--print");
      expect(args).toContain("channel_url");
      expect(args).toContain("--js-runtimes");
      expect(args).toContain("deno");
    });

    it("should return null on close with non-zero code", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const promise = getChannelUrlFromVideo("https://example.com/video");
      await flushAsyncSpawns();
      proc.stderr?.emit("data", Buffer.from("failed"));
      proc.emit("close", 1);
      await expect(promise).resolves.toBeNull();
    });

    it("should return null on spawn error", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const promise = getChannelUrlFromVideo("https://example.com/video");
      await flushAsyncSpawns();
      proc.emit("error", new Error("boom"));
      await expect(promise).resolves.toBeNull();
    });

    it("should return null when yt-dlp availability check fails", async () => {
      const versionProc = createMockProcess();
      vi.mocked(spawn).mockImplementationOnce(() => versionProc as any);

      const promise = getChannelUrlFromVideo("https://example.com/video");
      versionProc.emit(
        "error",
        Object.assign(new Error("permission denied"), { code: "EACCES" })
      );

      await expect(promise).resolves.toBeNull();
      expect(vi.mocked(spawn).mock.calls).toHaveLength(1);
    });
  });

  describe("downloadChannelAvatar", () => {
    it("should return false on non-zero close code", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      await flushAsyncSpawns();
      proc.stderr?.emit("data", Buffer.from("download failed"));
      proc.emit("close", 1);

      await expect(promise).resolves.toBe(false);
    });

    it("should rename non-jpg avatar to jpg when needed", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);
      vi.mocked(fs.existsSync).mockImplementation((target: any) =>
        String(target).endsWith("avatar.png")
      );

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      await flushAsyncSpawns();
      proc.emit("close", 0);

      await expect(promise).resolves.toBe(true);
      expect(fs.moveSync).toHaveBeenCalledWith("/tmp/avatar.png", "/tmp/avatar.jpg", {
        overwrite: true,
      });
    });

    it("should return true when output file exists directly", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);
      vi.mocked(fs.existsSync).mockImplementation((target: any) =>
        String(target).endsWith("avatar.jpg")
      );

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      await flushAsyncSpawns();
      proc.emit("close", 0);

      await expect(promise).resolves.toBe(true);
    });

    it("should return false when no avatar files are found", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      await flushAsyncSpawns();
      proc.emit("close", 0);

      await expect(promise).resolves.toBe(false);
    });

    it("should return false on spawn error", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      await flushAsyncSpawns();
      proc.emit("error", new Error("spawn error"));
      await expect(promise).resolves.toBe(false);
    });

    it("should return false when yt-dlp availability check fails", async () => {
      const versionProc = createMockProcess();
      vi.mocked(spawn).mockImplementationOnce(() => versionProc as any);

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      versionProc.emit(
        "error",
        Object.assign(new Error("permission denied"), { code: "EACCES" })
      );

      await expect(promise).resolves.toBe(false);
      expect(vi.mocked(spawn).mock.calls).toHaveLength(1);
    });
  });

  describe("executeYtDlpSpawn", () => {
    it("should resolve when subprocess exits with code 0", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionHelpAndDenoCheck("plural", proc);

      const subprocess = executeYtDlpSpawn("https://www.youtube.com/watch?v=abc", {
        format: "best",
      });
      const promise = Promise.resolve(subprocess);
      await flushAsyncSpawns();
      proc.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
      expect(subprocess.kill("SIGTERM")).toBe(true);
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("should reject with stderr when subprocess exits non-zero", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const subprocess = executeYtDlpSpawn("https://example.com/video");
      const promise = Promise.resolve(subprocess);
      await flushAsyncSpawns();
      proc.stderr?.emit("data", Buffer.from("bad stderr"));
      proc.emit("close", 3);

      await expect(promise).rejects.toMatchObject({
        message: "yt-dlp process exited with code 3",
        code: 3,
        stderr: "bad stderr",
      });
    });

    it("should reject on subprocess error event", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const subprocess = executeYtDlpSpawn("https://example.com/video");
      const promise = Promise.resolve(subprocess);
      await flushAsyncSpawns();
      proc.emit("error", new Error("spawn crashed"));

      await expect(promise).rejects.toThrow("spawn crashed");
    });

    it("should return false on kill when process already killed", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const subprocess = executeYtDlpSpawn("https://example.com/video");
      await flushAsyncSpawns();
      proc.killed = true;
      expect(subprocess.kill("SIGKILL")).toBe(false);
      expect(proc.kill).not.toHaveBeenCalled();
    });

    it("should reject as cancelled when killed before subprocess starts", async () => {
      const versionProc = createMockProcess();
      vi.mocked(spawn).mockImplementationOnce(() => versionProc as any);

      const subprocess = executeYtDlpSpawn("https://example.com/video");
      const promise = Promise.resolve(subprocess);
      expect(subprocess.kill("SIGTERM")).toBe(true);
      versionProc.emit("close", 0);

      await expect(promise).rejects.toThrow("yt-dlp process cancelled before start");
      expect(vi.mocked(spawn).mock.calls).toHaveLength(1);
    });
  });
});
