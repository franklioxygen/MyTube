import { spawn } from "child_process";
import { EventEmitter } from "events";
import fs from "fs-extra";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as storageService from "../../services/storageService";
import {
  InvalidProxyError,
  convertFlagToArg,
  downloadChannelAvatar,
  executeYtDlpJson,
  executeYtDlpSpawn,
  flagsToArgs,
  getAxiosProxyConfig,
  getChannelUrlFromVideo,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  parseYtDlpConfig,
} from "../../utils/ytDlpUtils";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));
vi.mock("fs-extra");
vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
}));
vi.mock("socks-proxy-agent", () => ({
  SocksProxyAgent: vi.fn().mockImplementation((url: string) => ({
    kind: "socks-agent",
    url,
  })),
}));

type MockProcess = EventEmitter & {
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
};

const createMockProcess = (): MockProcess => {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = vi.fn((signal?: NodeJS.Signals) => {
    proc.killed = true;
    return Boolean(signal || true);
  });
  return proc;
};

describe("ytDlpUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(storageService.getSettings).mockReturnValue({});
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
        "youtube:key=value",
        "--extractor-args",
        "generic:abc=def",
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

  describe("executeYtDlpJson", () => {
    it("should execute and parse json output with youtube runtime and cookies", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);
      vi.mocked(fs.existsSync).mockImplementation((target: any) =>
        String(target).endsWith(path.join("data", "cookies.txt"))
      );

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc", {
        format: "best",
      });

      proc.stdout?.emit("data", Buffer.from('{"id":"abc","title":"video"}'));
      proc.stderr?.emit("data", Buffer.from("[info] metadata"));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({
        id: "abc",
        title: "video",
      });

      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(args).toContain("--dump-single-json");
      expect(args).toContain("--js-runtime");
      expect(args).toContain("node");
      expect(args).toContain("--cookies");
    });

    it("should preprocess xvideos.red urls before spawning", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const promise = executeYtDlpJson("https://xvideos.red/video/123");
      proc.stdout?.emit("data", Buffer.from("{}"));
      proc.emit("close", 0);
      await promise;

      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(args[args.length - 1]).toContain("xvideos.com/video/123");
    });

    it("should retry without format restrictions on format error", async () => {
      const first = createMockProcess();
      const second = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(first as any).mockReturnValueOnce(second as any);

      const promise = executeYtDlpJson("https://example.com/video", {
        format: "best",
        formatSort: "res:2160",
      });

      first.stderr?.emit("data", Buffer.from("Requested format is not available"));
      first.emit("close", 1);
      second.stdout?.emit("data", Buffer.from('{"ok":true}'));
      second.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });

      const secondArgs = vi.mocked(spawn).mock.calls[1][1] as string[];
      expect(secondArgs).not.toContain("--format");
      expect(secondArgs).not.toContain("--format-sort");
      expect(secondArgs).toContain("https://example.com/video");
    });

    it("should retry with explicit best format when format error comes from config", async () => {
      const first = createMockProcess();
      const second = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(first as any).mockReturnValueOnce(second as any);

      const promise = executeYtDlpJson("https://example.com/video", {});

      first.stderr?.emit("data", Buffer.from("No video formats found"));
      first.emit("close", 1);
      second.stdout?.emit("data", Buffer.from('{"fallback":true}'));
      second.emit("close", 0);

      await expect(promise).resolves.toEqual({ fallback: true });
      const secondArgs = vi.mocked(spawn).mock.calls[1][1] as string[];
      expect(secondArgs).toContain("--format");
      expect(secondArgs).toContain("best");
    });

    it("should reject with stderr on non-zero non-format error", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const promise = executeYtDlpJson("https://example.com/video");
      proc.stderr?.emit("data", Buffer.from("fatal error"));
      proc.emit("close", 2);

      await expect(promise).rejects.toMatchObject({
        message: "yt-dlp process exited with code 2",
        stderr: "fatal error",
      });
    });

    it("should reject when json parse fails", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const promise = executeYtDlpJson("https://example.com/video");
      proc.stdout?.emit("data", Buffer.from("not-json"));
      proc.emit("close", 0);

      await expect(promise).rejects.toThrow("Failed to parse yt-dlp output as JSON");
    });

    it("should reject when subprocess emits error", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const promise = executeYtDlpJson("https://example.com/video");
      proc.emit("error", new Error("spawn failed"));

      await expect(promise).rejects.toThrow("spawn failed");
    });
  });

  describe("getChannelUrlFromVideo", () => {
    it("should return trimmed channel url on success", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const promise = getChannelUrlFromVideo("https://www.youtube.com/watch?v=abc", {
        proxy: "http://127.0.0.1:7890",
      });

      proc.stdout?.emit("data", Buffer.from("https://www.youtube.com/@channel\n"));
      proc.emit("close", 0);

      await expect(promise).resolves.toBe("https://www.youtube.com/@channel");

      const args = vi.mocked(spawn).mock.calls[0][1] as string[];
      expect(args).toContain("--print");
      expect(args).toContain("channel_url");
      expect(args).toContain("--js-runtime");
      expect(args).toContain("node");
    });

    it("should return null on close with non-zero code", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const promise = getChannelUrlFromVideo("https://example.com/video");
      proc.stderr?.emit("data", Buffer.from("failed"));
      proc.emit("close", 1);
      await expect(promise).resolves.toBeNull();
    });

    it("should return null on spawn error", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const promise = getChannelUrlFromVideo("https://example.com/video");
      proc.emit("error", new Error("boom"));
      await expect(promise).resolves.toBeNull();
    });
  });

  describe("downloadChannelAvatar", () => {
    it("should return false on non-zero close code", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      proc.stderr?.emit("data", Buffer.from("download failed"));
      proc.emit("close", 1);

      await expect(promise).resolves.toBe(false);
    });

    it("should rename non-jpg avatar to jpg when needed", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);
      vi.mocked(fs.existsSync).mockImplementation((target: any) =>
        String(target).endsWith("avatar.png")
      );

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      proc.emit("close", 0);

      await expect(promise).resolves.toBe(true);
      expect(fs.moveSync).toHaveBeenCalledWith("/tmp/avatar.png", "/tmp/avatar.jpg", {
        overwrite: true,
      });
    });

    it("should return true when output file exists directly", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);
      vi.mocked(fs.existsSync).mockImplementation((target: any) =>
        String(target).endsWith("avatar.jpg")
      );

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      proc.emit("close", 0);

      await expect(promise).resolves.toBe(true);
    });

    it("should return false when no avatar files are found", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      proc.emit("close", 0);

      await expect(promise).resolves.toBe(false);
    });

    it("should return false on spawn error", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const promise = downloadChannelAvatar(
        "https://www.youtube.com/@channel",
        "/tmp/avatar.jpg"
      );
      proc.emit("error", new Error("spawn error"));
      await expect(promise).resolves.toBe(false);
    });
  });

  describe("executeYtDlpSpawn", () => {
    it("should resolve when subprocess exits with code 0", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const subprocess = executeYtDlpSpawn("https://www.youtube.com/watch?v=abc", {
        format: "best",
      });
      const promise = Promise.resolve(subprocess);
      proc.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
      expect(subprocess.kill("SIGTERM")).toBe(true);
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("should reject with stderr when subprocess exits non-zero", async () => {
      const proc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const subprocess = executeYtDlpSpawn("https://example.com/video");
      const promise = Promise.resolve(subprocess);
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
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const subprocess = executeYtDlpSpawn("https://example.com/video");
      const promise = Promise.resolve(subprocess);
      proc.emit("error", new Error("spawn crashed"));

      await expect(promise).rejects.toThrow("spawn crashed");
    });

    it("should return false on kill when process already killed", () => {
      const proc = createMockProcess();
      proc.killed = true;
      vi.mocked(spawn).mockReturnValueOnce(proc as any);

      const subprocess = executeYtDlpSpawn("https://example.com/video");
      expect(subprocess.kill("SIGKILL")).toBe(false);
      expect(proc.kill).not.toHaveBeenCalled();
    });
  });
});
