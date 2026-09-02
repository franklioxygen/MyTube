import { spawn } from "child_process";
import { EventEmitter } from "events";
import fs from "fs-extra";
import path from "path";
import { PassThrough } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storageService from "../../services/storageService";
import {
  getProviderPluginPath,
  getProviderScript,
} from "../../services/downloaders/ytdlp/ytdlpHelpers";
import { SocksProxyAgent } from "socks-proxy-agent";
import {
  appendYtDlpInputOperand,
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
import { installYtDlp } from "../../utils/ytdlp/install";
import { installManagedRelease } from "../../utils/ytdlp/release";
import { logger } from "../../utils/logger";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));
vi.mock("fs-extra");
vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
}));
vi.mock("../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderPluginPath: vi.fn(),
  getProviderScript: vi.fn(),
}));
vi.mock("socks-proxy-agent", () => ({
  SocksProxyAgent: vi.fn().mockImplementation(function (this: unknown, url: string) {
    return {
      kind: "socks-agent",
      url,
    };
  }),
}));
function publishOutcome(
  releaseId: string,
  generation: number,
  previousReleaseId: string | null = null
) {
  return {
    published: true,
    current: {
      schemaVersion: 1 as const,
      generation,
      releaseId,
      previousReleaseId,
      publishedAt: new Date().toISOString(),
    },
  };
}

vi.mock("../../utils/ytdlp/release", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/ytdlp/release")>();
  return {
    ...actual,
    installManagedRelease: vi.fn(async () => publishOutcome("rel-test", 1)),
  };
});

type MockProcess = EventEmitter & {
  stdout: PassThrough | null;
  stderr: PassThrough | null;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
};

type JsRuntimeFlagStyle = "plural" | "singular" | "none";

const FRESH_YT_DLP_VERSION = "2099.03.17";
const OLDER_FRESH_YT_DLP_VERSION = "2099.01.01";

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

const createVersionCheckProcess = (version: string = FRESH_YT_DLP_VERSION): MockProcess => {
  const proc = createMockProcess();
  queueMicrotask(() => {
    proc.stdout?.emit("data", Buffer.from(`${version}\n`));
    proc.emit("close", 0);
  });
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
        ? "    --js-runtimes RUNTIME[:PATH]\n    --remote-components COMPONENT\n"
        : flagStyle === "singular"
          ? "    --js-runtime RUNTIME[:PATH]\n    --remote-components COMPONENT\n"
          : "";
    proc.stdout?.emit("data", Buffer.from(helpText));
    proc.emit("close", 0);
  });
  return proc;
};

const createImpersonateCheckProcess = (): MockProcess => {
  const proc = createMockProcess();
  queueMicrotask(() => {
    proc.stdout?.emit(
      "data",
      Buffer.from("chrome        curl_cffi\n")
    );
    proc.emit("close", 0);
  });
  return proc;
};

const isProbeArgs = (
  args: readonly string[] | undefined,
  flag: string
): boolean => Array.isArray(args) && args.length === 1 && args[0] === flag;

const mockRoutedYtDlpSpawn = (
  options: {
    helpStyle?: JsRuntimeFlagStyle;
    version?: string;
    denoProc?: MockProcess;
  },
  ...commandProcesses: MockProcess[]
) => {
  const queue = [...commandProcesses];
  vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
    if (command === "deno") {
      return (options.denoProc ?? createDenoCheckProcess()) as any;
    }
    if (isProbeArgs(args, "--version")) {
      return createVersionCheckProcess(options.version) as any;
    }
    if (isProbeArgs(args, "--help")) {
      return createHelpCheckProcess(options.helpStyle ?? "plural") as any;
    }
    if (Array.isArray(args) && args.includes("--list-impersonate-targets")) {
      return createImpersonateCheckProcess() as any;
    }
    const next = queue.shift();
    return (next ?? createMockProcess()) as any;
  });
};

const mockSpawnWithVersionCheck = (...processes: MockProcess[]) => {
  mockRoutedYtDlpSpawn({ helpStyle: "none" }, ...processes);
};

const mockSpawnWithVersionAndHelpCheck = (
  flagStyle: JsRuntimeFlagStyle = "plural",
  ...processes: MockProcess[]
) => {
  mockRoutedYtDlpSpawn({ helpStyle: flagStyle }, ...processes);
};

const mockSpawnWithVersionHelpAndDenoCheck = (
  flagStyle: JsRuntimeFlagStyle = "plural",
  ...processes: MockProcess[]
) => {
  mockRoutedYtDlpSpawn({ helpStyle: flagStyle }, ...processes);
};

const mockSpawnWithVersionYouTubeHelpAndDenoCheck = (
  flagStyle: JsRuntimeFlagStyle = "plural",
  ...processes: MockProcess[]
) => {
  mockRoutedYtDlpSpawn({ helpStyle: flagStyle }, ...processes);
};

const mockSpawnWithVersionYouTubeHelpCheck = (
  flagStyle: JsRuntimeFlagStyle = "plural",
  ...processes: MockProcess[]
) => {
  mockRoutedYtDlpSpawn({ helpStyle: flagStyle }, ...processes);
};

const mockPathCandidateSpawn = (
  candidates: Array<{
    binDir: string;
    version?: string;
    helpStyle?: JsRuntimeFlagStyle;
    versionProc?: MockProcess;
    helpProc?: MockProcess;
  }>,
  commandProc: MockProcess
) => {
  vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
    const list = Array.isArray(args) ? args : [];
    if (command === "deno") {
      return createDenoCheckProcess() as any;
    }
    const candidate = candidates.find(
      (entry) => command === path.join(entry.binDir, "yt-dlp")
    );
    if (candidate) {
      if (list.includes("--version")) {
        if (candidate.versionProc) {
          return candidate.versionProc as any;
        }
        return createVersionCheckProcess(candidate.version) as any;
      }
      if (list.includes("--help")) {
        if (candidate.helpProc) {
          return candidate.helpProc as any;
        }
        return createHelpCheckProcess(candidate.helpStyle ?? "none") as any;
      }
      if (list.includes("--list-impersonate-targets")) {
        return createImpersonateCheckProcess() as any;
      }
      return commandProc as any;
    }
    if (isProbeArgs(list, "--version")) {
      return createVersionCheckProcess() as any;
    }
    if (isProbeArgs(list, "--help")) {
      return createHelpCheckProcess("plural") as any;
    }
    if (list.includes("--list-impersonate-targets")) {
      return createImpersonateCheckProcess() as any;
    }
    return commandProc as any;
  });
};

const flushAsyncSpawns = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

const flushMicrotasks = async (count: number = 10) => {
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve();
  }
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

const getSpawnOptionsForUrl = (
  url: string,
  occurrence: number = 0,
): Record<string, any> => {
  const matchingCalls = vi.mocked(spawn).mock.calls.filter(([, args]) =>
    Array.isArray(args) && args.includes(url)
  );
  const call = matchingCalls[occurrence];
  if (!call) {
    throw new Error(`Expected spawn call for ${url}`);
  }
  return (call[2] as Record<string, any>) ?? {};
};

const expectProtectedInputOperand = (args: string[], input: string): void => {
  expect(args.slice(-2)).toEqual(["--", input]);
};

const createMissingFileError = (): NodeJS.ErrnoException =>
  Object.assign(new Error("File not found"), { code: "ENOENT" });

const validNetscapeCookies =
  "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tf4=4000000\n";

describe("ytDlpUtils", () => {
  const originalYtDlpPath = process.env.YT_DLP_PATH;
  const originalPath = process.env.PATH;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalAppData = process.env.APPDATA;
  const originalLocalAppData = process.env.LOCALAPPDATA;

  beforeEach(() => {
    vi.resetAllMocks();
    resetYtDlpAvailabilityCacheForTests();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue(validNetscapeCookies);
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw createMissingFileError();
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(storageService.getSettings).mockReturnValue({});
    vi.mocked(getProviderPluginPath).mockReturnValue("");
    vi.mocked(getProviderScript).mockReturnValue("");
    vi.mocked(SocksProxyAgent).mockImplementation(function (
      this: unknown,
      url: string | URL
    ) {
      return {
        kind: "socks-agent",
        url: String(url),
      };
    } as any);
    process.env.YT_DLP_PATH = "yt-dlp";
    delete process.env.YT_DLP_JS_RUNTIME;
    delete process.env.PYTHONPATH;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalYtDlpPath === undefined) {
      delete process.env.YT_DLP_PATH;
    } else {
      process.env.YT_DLP_PATH = originalYtDlpPath;
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData;
    }
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

  describe("appendYtDlpInputOperand", () => {
    it("places untrusted input after the end-of-options marker", () => {
      const args = ["--dump-single-json"];

      appendYtDlpInputOperand(args, "--exec=touch /tmp/marker");

      expect(args).toEqual([
        "--dump-single-json",
        "--",
        "--exec=touch /tmp/marker",
      ]);
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

    it("should pass through auth/cookie/header options for discovery probes", () => {
      const cfg = getNetworkConfigFromUserConfig({
        cookies: "/data/cookies.txt",
        cookiesFromBrowser: "firefox",
        addHeaders: "X-Custom:1",
        username: "user",
        password: "secret",
        format: "bestvideo",
      });

      expect(cfg).toEqual({
        cookies: "/data/cookies.txt",
        cookiesFromBrowser: "firefox",
        addHeaders: "X-Custom:1",
        username: "user",
        password: "secret",
      });
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
      await flushAsyncSpawns();
      versionProc.emit("close", 1);

      await expect(promise).resolves.toBeUndefined();
      expect(vi.mocked(spawn).mock.calls).toHaveLength(1);
    });

    it("should auto-install when yt-dlp is missing", async () => {
      const versionProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => versionProc as any)
        .mockImplementationOnce(() => createVersionCheckProcess() as any);

      const promise = ensureYtDlpAvailable();
      await flushAsyncSpawns();
      versionProc.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));

      await expect(promise).resolves.toBeUndefined();
      expect(vi.mocked(installManagedRelease)).toHaveBeenCalled();
      expect(
        vi.mocked(spawn).mock.calls.some(
          ([, args]) => Array.isArray(args) && args.includes("--user")
        )
      ).toBe(false);
    });

    it("should serialize concurrent pip runs so two installs never overlap", async () => {
      let releaseInstall: () => void = () => {};
      const firstGate = new Promise<ReturnType<typeof publishOutcome>>((resolve) => {
        releaseInstall = () =>
          resolve(publishOutcome("rel-test", 1));
      });
      vi.mocked(installManagedRelease)
        .mockImplementationOnce(() => firstGate)
        .mockResolvedValue(publishOutcome("rel-test-2", 2, "rel-test"));

      const first = installYtDlp();
      const second = installYtDlp({ upgrade: true });
      await flushAsyncSpawns();

      expect(vi.mocked(installManagedRelease)).toHaveBeenCalledTimes(2);

      releaseInstall();
      await expect(Promise.all([first, second])).resolves.toBeDefined();
    });

    it("should keep serializing after a failed pip run", async () => {
      vi.mocked(installManagedRelease)
        .mockRejectedValueOnce(new Error("yt-dlp could not be automatically installed"))
        .mockResolvedValueOnce(publishOutcome("rel-test", 1));

      const failing = installYtDlp();
      const queued = installYtDlp({ upgrade: true });

      await expect(failing).rejects.toThrow(/could not be automatically/);
      await expect(queued).resolves.toEqual({ published: true });
    });

    it("should skip the pip bgutil provider when a bundled provider is present", async () => {
      vi.mocked(getProviderPluginPath).mockReturnValue("/app/bgutil-ytdlp-pot-provider");
      const versionProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => versionProc as any)
        .mockImplementationOnce(() => createVersionCheckProcess() as any);

      const promise = ensureYtDlpAvailable();
      await flushAsyncSpawns();
      versionProc.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));

      await expect(promise).resolves.toBeUndefined();
      expect(vi.mocked(installManagedRelease)).toHaveBeenCalled();
    });

    it("should continue with the current stale yt-dlp when auto-upgrade fails", async () => {
      vi.mocked(installManagedRelease).mockRejectedValueOnce(
        new Error("No usable Python interpreter with pip was found.")
      );
      const staleVersionProc = createMockProcess();
      vi.mocked(spawn).mockImplementationOnce(() => staleVersionProc as any);

      const promise = ensureYtDlpAvailable();
      await flushAsyncSpawns();
      staleVersionProc.stdout?.emit("data", Buffer.from("2020.01.01\n"));
      staleVersionProc.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
      expect(vi.mocked(installManagedRelease)).toHaveBeenCalled();
    });

    it("should not rewrite PATH after a managed auto-upgrade", async () => {
      process.env.YT_DLP_PATH = "yt-dlp";
      process.env.HOME = "/tmp/test-home";
      const userBinDir = path.join(process.env.HOME, ".local", "bin");
      const originalPath = ["/old/bin", userBinDir, "/usr/bin"].join(path.delimiter);
      process.env.PATH = originalPath;

      const staleVersionProc = createMockProcess();
      const freshVersionProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => staleVersionProc as any)
        .mockImplementationOnce(() => freshVersionProc as any);

      const promise = ensureYtDlpAvailable();
      await flushAsyncSpawns();
      staleVersionProc.stdout?.emit("data", Buffer.from("2020.01.01\n"));
      staleVersionProc.emit("close", 0);
      await flushAsyncSpawns();
      freshVersionProc.stdout?.emit("data", Buffer.from(`${FRESH_YT_DLP_VERSION}\n`));
      freshVersionProc.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
      expect(vi.mocked(installManagedRelease)).toHaveBeenCalled();
      expect(process.env.PATH).toBe(originalPath);
    });

    it("should not scan ~/.local/bin after a managed auto-install", async () => {
      delete process.env.YT_DLP_PATH;
      process.env.PATH = "/usr/bin";
      process.env.HOME = "/tmp/test-home";
      const userSiteYtDlp = path.join(
        process.env.HOME,
        ".local",
        "bin",
        "yt-dlp"
      );

      const firstVersionProc = createMockProcess();
      const secondVersionProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => firstVersionProc as any)
        .mockImplementationOnce(() => secondVersionProc as any);

      const promise = ensureYtDlpAvailable();
      await flushAsyncSpawns();
      firstVersionProc.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));
      await flushAsyncSpawns();
      secondVersionProc.emit("error", Object.assign(new Error("still missing"), { code: "ENOENT" }));

      await expect(promise).rejects.toThrow(/still not usable/);
      expect(vi.mocked(installManagedRelease)).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(spawn).mock.calls.some(([cmd]) => String(cmd) === userSiteYtDlp)
      ).toBe(false);
    });

    it("should not scan Windows Python Scripts after a managed auto-install", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });

      try {
        delete process.env.YT_DLP_PATH;
        delete process.env.HOME;
        process.env.PATH = "/windows/system32";
        process.env.USERPROFILE = "/tmp/test-user";
        process.env.APPDATA = "/tmp/test-user/AppData/Roaming";
        delete process.env.LOCALAPPDATA;

        const scriptsYtDlp = path.join(
          process.env.APPDATA,
          "Python",
          "Python313",
          "Scripts",
          "yt-dlp.exe"
        );

        const firstVersionProc = createMockProcess();
        const secondVersionProc = createMockProcess();
        vi.mocked(spawn)
          .mockImplementationOnce(() => firstVersionProc as any)
          .mockImplementationOnce(() => secondVersionProc as any);

        const promise = ensureYtDlpAvailable();
        await flushAsyncSpawns();
        firstVersionProc.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));
        await flushAsyncSpawns();
        secondVersionProc.emit("error", Object.assign(new Error("still missing"), { code: "ENOENT" }));

        await expect(promise).rejects.toThrow(/still not usable/);
        expect(vi.mocked(installManagedRelease)).toHaveBeenCalledTimes(1);
        expect(
          vi.mocked(spawn).mock.calls.some(([cmd]) => String(cmd) === scriptsYtDlp)
        ).toBe(false);
      } finally {
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
      }
    });

    it("should stop retrying auto-install when yt-dlp is still missing after install", async () => {
      const firstVersionProc = createMockProcess();
      const secondVersionProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => firstVersionProc as any)
        .mockImplementationOnce(() => secondVersionProc as any);

      const promise = ensureYtDlpAvailable();
      await flushAsyncSpawns();
      firstVersionProc.emit(
        "error",
        Object.assign(new Error("not found"), { code: "ENOENT" })
      );
      await flushAsyncSpawns();
      secondVersionProc.emit(
        "error",
        Object.assign(new Error("still not found"), { code: "ENOENT" })
      );

      await expect(promise).rejects.toThrow(/still not usable/);
      expect(vi.mocked(installManagedRelease)).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(spawn).mock.calls.filter(([cmd]) => cmd === "pip3")
      ).toHaveLength(0);
    });

    it("should throw when yt-dlp exists but is not executable", async () => {
      const versionProc = createMockProcess();
      vi.mocked(spawn).mockImplementationOnce(() => versionProc as any);

      const promise = ensureYtDlpAvailable();
      await flushAsyncSpawns();
      versionProc.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" }));

      await expect(promise).rejects.toThrow("not executable");
    });

    it("should mention the resolved configured path in ENOENT errors", async () => {
      process.env.YT_DLP_PATH = "/custom/tools/yt-dlp";
      const versionProc = createMockProcess();
      vi.mocked(spawn).mockImplementationOnce(() => versionProc as any);

      const promise = ensureYtDlpAvailable();
      await flushAsyncSpawns();
      versionProc.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));

      await expect(promise).rejects.toThrow(
        "yt-dlp not found at configured path: /custom/tools/yt-dlp"
      );
    });

    it("should reset cache after failure so the next call retries", async () => {
      const failProc = createMockProcess();
      const successProc = createMockProcess();
      vi.mocked(spawn)
        .mockImplementationOnce(() => failProc as any)
        .mockImplementationOnce(() => successProc as any);

      // First call: fails due to permissions error
      const firstPromise = ensureYtDlpAvailable();
      await flushAsyncSpawns();
      failProc.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" }));
      await expect(firstPromise).rejects.toThrow("not executable");

      // Second call: cache was reset, so a new version check is spawned and succeeds
      const secondPromise = ensureYtDlpAvailable();
      await flushAsyncSpawns();
      successProc.emit("close", 0);
      await expect(secondPromise).resolves.toBeUndefined();

      expect(vi.mocked(spawn).mock.calls).toHaveLength(2);
    });
  });

  describe("executeYtDlpJson", () => {
    it("should prefer a PATH yt-dlp candidate that supports --js-runtimes when YT_DLP_PATH is unset", async () => {
      delete process.env.YT_DLP_PATH;
      process.env.PATH = ["/old/bin", "/new/bin"].join(path.delimiter);
      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const normalizedTarget = String(target);
        return (
          normalizedTarget === path.join("/old/bin", "yt-dlp") ||
          normalizedTarget === path.join("/new/bin", "yt-dlp")
        );
      });

      const proc = createMockProcess();
      mockPathCandidateSpawn(
        [
          {
            binDir: "/old/bin",
            version: OLDER_FRESH_YT_DLP_VERSION,
            helpStyle: "none",
          },
          {
            binDir: "/new/bin",
            version: FRESH_YT_DLP_VERSION,
            helpStyle: "plural",
          },
        ],
        proc
      );

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });

      const downloadCall = vi
        .mocked(spawn)
        .mock.calls.find(
          ([cmd, args]) =>
            cmd === path.join("/new/bin", "yt-dlp") &&
            Array.isArray(args) &&
            args.includes("https://www.youtube.com/watch?v=abc")
        );

      expect(downloadCall).toBeDefined();
    });

    it("should skip broken PATH yt-dlp candidates when choosing a fallback", async () => {
      delete process.env.YT_DLP_PATH;
      process.env.PATH = ["/broken/bin", "/working/bin"].join(path.delimiter);
      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const normalizedTarget = String(target);
        return (
          normalizedTarget === path.join("/broken/bin", "yt-dlp") ||
          normalizedTarget === path.join("/working/bin", "yt-dlp")
        );
      });

      const brokenProc = createMockProcess();
      const proc = createMockProcess();
      mockPathCandidateSpawn(
        [
          {
            binDir: "/broken/bin",
            versionProc: brokenProc,
          },
          {
            binDir: "/working/bin",
            version: FRESH_YT_DLP_VERSION,
            helpStyle: "none",
          },
        ],
        proc
      );

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      brokenProc.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" }));
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });

      const downloadCall = vi
        .mocked(spawn)
        .mock.calls.find(
          ([cmd, args]) =>
            cmd === path.join("/working/bin", "yt-dlp") &&
            Array.isArray(args) &&
            args.includes("https://www.youtube.com/watch?v=abc")
        );

      expect(downloadCall).toBeDefined();
    });

    it("should skip PATH yt-dlp candidates when --help exits non-zero", async () => {
      delete process.env.YT_DLP_PATH;
      process.env.PATH = ["/broken/bin", "/working/bin"].join(path.delimiter);
      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const normalizedTarget = String(target);
        return (
          normalizedTarget === path.join("/broken/bin", "yt-dlp") ||
          normalizedTarget === path.join("/working/bin", "yt-dlp")
        );
      });

      const brokenProc = createMockProcess();
      const proc = createMockProcess();
      mockPathCandidateSpawn(
        [
          {
            binDir: "/broken/bin",
            version: OLDER_FRESH_YT_DLP_VERSION,
            helpProc: brokenProc,
          },
          {
            binDir: "/working/bin",
            version: FRESH_YT_DLP_VERSION,
            helpStyle: "none",
          },
        ],
        proc
      );

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      brokenProc.emit("close", 1);
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });

      const downloadCall = vi
        .mocked(spawn)
        .mock.calls.find(
          ([cmd, args]) =>
            cmd === path.join("/working/bin", "yt-dlp") &&
            Array.isArray(args) &&
            args.includes("https://www.youtube.com/watch?v=abc")
        );

      expect(downloadCall).toBeDefined();
    });

    it("should time out hanging PATH yt-dlp candidates and continue", async () => {
      vi.useFakeTimers();
      delete process.env.YT_DLP_PATH;
      process.env.PATH = ["/hanging/bin", "/working/bin"].join(path.delimiter);
      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const normalizedTarget = String(target);
        return (
          normalizedTarget === path.join("/hanging/bin", "yt-dlp") ||
          normalizedTarget === path.join("/working/bin", "yt-dlp")
        );
      });

      const hangingProc = createMockProcess();
      const proc = createMockProcess();
      mockPathCandidateSpawn(
        [
          {
            binDir: "/hanging/bin",
            versionProc: hangingProc,
          },
          {
            binDir: "/working/bin",
            version: FRESH_YT_DLP_VERSION,
            helpStyle: "none",
          },
        ],
        proc
      );

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await vi.advanceTimersByTimeAsync(5000);
      await flushMicrotasks();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      expect(hangingProc.kill).toHaveBeenCalledWith("SIGTERM");

      const downloadCall = vi
        .mocked(spawn)
        .mock.calls.find(
          ([cmd, args]) =>
            cmd === path.join("/working/bin", "yt-dlp") &&
            Array.isArray(args) &&
            args.includes("https://www.youtube.com/watch?v=abc")
        );

      expect(downloadCall).toBeDefined();
    });

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
      expectProtectedInputOperand(
        args,
        "https://www.youtube.com/watch?v=abc",
      );
    });

    it("protects an option-like input from yt-dlp argument parsing", async () => {
      const input = "--exec=touch /tmp/marker";
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const promise = executeYtDlpJson(input);
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      expectProtectedInputOperand(getSpawnArgsForUrl(input), input);
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

    it("should add the provider extractor arg for youtube when bundled provider is available", async () => {
      vi.mocked(getProviderScript).mockReturnValue(
        "/app/bgutil-ytdlp-pot-provider/server/build/generate_once.js",
      );
      const proc = createMockProcess();
      mockSpawnWithVersionYouTubeHelpAndDenoCheck("plural", proc);

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
      mockSpawnWithVersionYouTubeHelpAndDenoCheck("plural", proc);

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

    it("should add default remote components for youtube when not explicitly configured", async () => {
      vi.mocked(getProviderScript).mockReturnValue("/tmp/provider.js");
      const proc = createMockProcess();
      mockSpawnWithVersionYouTubeHelpAndDenoCheck("plural", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      const remoteComponentsIndex = args.indexOf("--remote-components");
      expect(remoteComponentsIndex).toBeGreaterThan(-1);
      expect(args[remoteComponentsIndex + 1]).toBe("ejs:github");
    });

    it("should respect explicit youtube remote components configuration", async () => {
      vi.mocked(getProviderScript).mockReturnValue("/tmp/provider.js");
      const proc = createMockProcess();
      mockSpawnWithVersionYouTubeHelpAndDenoCheck("plural", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc", {
        remoteComponents: "ejs:npm",
      });
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      const remoteComponentsIndex = args.indexOf("--remote-components");
      expect(remoteComponentsIndex).toBeGreaterThan(-1);
      expect(args[remoteComponentsIndex + 1]).toBe("ejs:npm");
    });

    it("should skip remote components when yt-dlp help does not expose the flag", async () => {
      vi.mocked(getProviderScript).mockReturnValue("/tmp/provider.js");
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const proc = createMockProcess();
      mockSpawnWithVersionYouTubeHelpCheck("none", proc);

      const promise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      proc.stdout?.emit("data", Buffer.from('{"ok":true}'));
      proc.emit("close", 0);

      await expect(promise).resolves.toEqual({ ok: true });
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      expect(args).not.toContain("--remote-components");
      expect(warnSpy).toHaveBeenCalledWith(
        "[yt-dlp] Current yt-dlp binary does not support --remote-components. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
      );
      warnSpy.mockRestore();
    });

    it("should not append duplicate provider extractor args", async () => {
      vi.mocked(getProviderScript).mockReturnValue("/tmp/provider.js");
      const proc = createMockProcess();
      mockSpawnWithVersionYouTubeHelpAndDenoCheck("plural", proc);

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
      mockSpawnWithVersionYouTubeHelpAndDenoCheck("plural", proc);

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
      expectProtectedInputOperand(
        args,
        "https://www.youtube.com/watch?v=abc",
      );
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
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
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

    it("should re-check js runtime support after a transient unsupported result", async () => {
      process.env.YT_DLP_JS_RUNTIME = "node";
      const firstProc = createMockProcess();
      const secondProc = createMockProcess();
      mockRoutedYtDlpSpawn({ helpStyle: "none" }, firstProc);

      const firstPromise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      firstProc.stdout?.emit("data", Buffer.from('{"attempt":1}'));
      firstProc.emit("close", 0);
      await expect(firstPromise).resolves.toEqual({ attempt: 1 });

      resetYtDlpAvailabilityCacheForTests();
      mockRoutedYtDlpSpawn({ helpStyle: "plural" }, secondProc);

      const secondPromise = executeYtDlpJson("https://www.youtube.com/watch?v=abc");
      await flushAsyncSpawns();
      secondProc.stdout?.emit("data", Buffer.from('{"attempt":2}'));
      secondProc.emit("close", 0);
      await expect(secondPromise).resolves.toEqual({ attempt: 2 });

      const secondArgs = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc", 1);
      expect(secondArgs).toContain("--js-runtimes");
      expect(secondArgs).toContain("node");
    });

    it("should warn explicitly when YT_DLP_JS_RUNTIME=deno but deno is unavailable", async () => {
      process.env.YT_DLP_JS_RUNTIME = "deno";
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const denoCheckProc = createMockProcess();
      const ytProc = createMockProcess();
      mockRoutedYtDlpSpawn({ helpStyle: "plural", denoProc: denoCheckProc }, ytProc);

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
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
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
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const denoCheckProc = createMockProcess();
      const ytProc = createMockProcess();
      mockRoutedYtDlpSpawn({ helpStyle: "plural", denoProc: denoCheckProc }, ytProc);

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
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const denoCheckProc = createMockProcess();
      const ytProc = createMockProcess();
      mockRoutedYtDlpSpawn({ helpStyle: "plural", denoProc: denoCheckProc }, ytProc);

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
      expectProtectedInputOperand(
        args,
        "https://www.youtube.com/watch?v=abc",
      );
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
      await flushAsyncSpawns();
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
      expectProtectedInputOperand(
        getSpawnArgsForUrl("https://www.youtube.com/@channel"),
        "https://www.youtube.com/@channel",
      );
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
      await flushAsyncSpawns();
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
      expectProtectedInputOperand(
        getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc"),
        "https://www.youtube.com/watch?v=abc",
      );
      expect(subprocess.kill("SIGTERM")).toBe(true);
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("should add the provider extractor arg for spawned youtube downloads", async () => {
      vi.mocked(getProviderScript).mockReturnValue("/tmp/provider.js");
      const proc = createMockProcess();
      mockSpawnWithVersionYouTubeHelpAndDenoCheck("plural", proc);

      const subprocess = executeYtDlpSpawn("https://www.youtube.com/watch?v=abc", {
        format: "best",
      });
      const promise = Promise.resolve(subprocess);
      await flushAsyncSpawns();
      proc.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
      const args = getSpawnArgsForUrl("https://www.youtube.com/watch?v=abc");
      const extractorArgsIndex = args.indexOf("--extractor-args");
      expect(extractorArgsIndex).toBeGreaterThan(-1);
      expect(args[extractorArgsIndex + 1]).toContain(
        "youtube:player_client=default,mweb",
      );
      expect(args[extractorArgsIndex + 1]).toContain(
        "youtubepot-bgutilscript:script_path=/tmp/provider.js",
      );
    });

    it("should append the bundled provider plugin path to PYTHONPATH", async () => {
      vi.mocked(getProviderPluginPath).mockReturnValue("/tmp/bgutil-plugin");
      process.env.PYTHONPATH = "/tmp/existing-python-path";
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const subprocess = executeYtDlpSpawn("https://example.com/video");
      const promise = Promise.resolve(subprocess);
      await flushAsyncSpawns();
      proc.emit("close", 0);

      await expect(promise).resolves.toBeUndefined();
      const options = getSpawnOptionsForUrl("https://example.com/video");
      expect(options.env).toMatchObject({
        PYTHONPATH: `/tmp/bgutil-plugin${path.delimiter}/tmp/existing-python-path`,
      });
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

    it("logs members-only stderr as info, not error, on non-zero exit (issue #393)", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});

      const membersOnlyStderr =
        "ERROR: [youtube] v8INHztfIzs: Join this channel to get access to members-only content like this video, and other exclusive perks.\n";
      const subprocess = executeYtDlpSpawn("https://example.com/video");
      const promise = Promise.resolve(subprocess);
      await flushAsyncSpawns();
      proc.stderr?.emit("data", Buffer.from(membersOnlyStderr));
      proc.emit("close", 1);

      await expect(promise).rejects.toMatchObject({
        message: "yt-dlp process exited with code 1",
        code: 1,
        stderr: membersOnlyStderr,
      });
      // Benign skip: no error-level record for the members-only stderr.
      expect(errorSpy).not.toHaveBeenCalledWith(
        "yt-dlp error output:",
        membersOnlyStderr,
      );
      expect(infoSpy).toHaveBeenCalledWith(
        "yt-dlp skipped members-only content:",
        membersOnlyStderr,
      );

      errorSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it("should classify a killed subprocess as cancellation instead of code null", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const subprocess = executeYtDlpSpawn("https://example.com/video");
      const promise = Promise.resolve(subprocess);
      await flushAsyncSpawns();
      subprocess.kill("SIGTERM");
      proc.stderr?.emit("data", Buffer.from("partial stderr"));
      proc.emit("close", null, "SIGTERM");

      await expect(promise).rejects.toMatchObject({
        message: "yt-dlp process cancelled by SIGTERM",
        code: "SIGTERM",
        stderr: "partial stderr",
      });
    });

    it("should treat external signal termination as a process failure", async () => {
      const proc = createMockProcess();
      mockSpawnWithVersionCheck(proc);

      const subprocess = executeYtDlpSpawn("https://example.com/video");
      const promise = Promise.resolve(subprocess);
      await flushAsyncSpawns();
      proc.stderr?.emit("data", Buffer.from("external stop"));
      proc.emit("close", null, "SIGTERM");

      await expect(promise).rejects.toMatchObject({
        message: "yt-dlp process exited due to signal SIGTERM",
        code: "SIGTERM",
        stderr: "external stop",
      });
      expect(proc.kill).not.toHaveBeenCalled();
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
      await flushAsyncSpawns();
      versionProc.emit("close", 0);

      await expect(promise).rejects.toThrow("yt-dlp process cancelled before start");
      expect(vi.mocked(spawn).mock.calls).toHaveLength(1);
    });
  });
});
