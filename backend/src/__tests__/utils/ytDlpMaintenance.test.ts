import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: { get: vi.fn() },
}));
vi.mock("../../utils/ytdlp/install", () => ({
  installYtDlp: vi.fn(),
}));
vi.mock("../../utils/ytdlp/pathResolver", () => ({
  hasCustomConfiguredYtDlpPath: vi.fn(() => false),
  resetResolvedYtDlpPath: vi.fn(),
  resolveYtDlpPath: vi.fn(async () => "/usr/local/bin/yt-dlp"),
}));
vi.mock("../../utils/ytdlp/runtime", () => ({
  resetJsRuntimeFlag: vi.fn(),
  resetRemoteComponentsSupport: vi.fn(),
}));
vi.mock("../../utils/ytdlp/versionProbe", () => ({
  getYtDlpVersionInfo: vi.fn(),
}));

import axios from "axios";
import { installYtDlp } from "../../utils/ytdlp/install";
import { hasCustomConfiguredYtDlpPath } from "../../utils/ytdlp/pathResolver";
import { getYtDlpVersionInfo } from "../../utils/ytdlp/versionProbe";
import {
  getYtDlpStatus,
  isYtDlpUpdateAvailable,
  parseYtDlpReleaseTimestamp,
  updateYtDlp,
} from "../../utils/ytdlp/maintenance";

const axiosGet = vi.mocked(axios.get);
const installMock = vi.mocked(installYtDlp);
const versionProbeMock = vi.mocked(getYtDlpVersionInfo);
const customPathMock = vi.mocked(hasCustomConfiguredYtDlpPath);

const versionInfo = (version: string | null, canRun = true) => ({
  canRun,
  version,
  releaseTimestamp: null,
  isStale: false,
});

describe("yt-dlp maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // mockImplementation set by a previous test survives clearAllMocks.
    installMock.mockReset();
    installMock.mockResolvedValue({ published: true });
    customPathMock.mockReturnValue(false);
    axiosGet.mockResolvedValue({ data: { info: { version: "2026.8.19" } } });
    versionProbeMock.mockResolvedValue(versionInfo("2026.08.19"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("parseYtDlpReleaseTimestamp", () => {
    it("parses both the padded binary form and the PyPI form", () => {
      expect(parseYtDlpReleaseTimestamp("2026.08.19")).toBe(
        Date.UTC(2026, 7, 19)
      );
      expect(parseYtDlpReleaseTimestamp("2026.8.19")).toBe(
        Date.UTC(2026, 7, 19)
      );
    });

    it("returns null for missing or unparsable versions", () => {
      expect(parseYtDlpReleaseTimestamp(null)).toBeNull();
      expect(parseYtDlpReleaseTimestamp("nightly")).toBeNull();
    });
  });

  describe("isYtDlpUpdateAvailable", () => {
    it("only reports an update when the published release is newer", () => {
      expect(isYtDlpUpdateAvailable("2026.06.09", "2026.8.19")).toBe(true);
      expect(isYtDlpUpdateAvailable("2026.08.19", "2026.8.19")).toBe(false);
      expect(isYtDlpUpdateAvailable("2026.09.01", "2026.8.19")).toBe(false);
    });

    it("stays quiet when either version cannot be parsed", () => {
      expect(isYtDlpUpdateAvailable(null, "2026.8.19")).toBe(false);
      expect(isYtDlpUpdateAvailable("2026.06.09", null)).toBe(false);
    });
  });

  describe("getYtDlpStatus", () => {
    it("reports the installed version alongside the latest release", async () => {
      versionProbeMock.mockResolvedValue(versionInfo("2026.06.09"));

      const status = await getYtDlpStatus({ checkLatest: true });

      expect(status.version).toBe("2026.06.09");
      expect(status.latestVersion).toBe("2026.8.19");
      expect(status.updateAvailable).toBe(true);
      expect(status.updateSupported).toBe(true);
      expect(status.path).toBe("/usr/local/bin/yt-dlp");
    });

    it("skips the PyPI lookup when the caller opts out", async () => {
      const status = await getYtDlpStatus({ checkLatest: false });

      expect(axiosGet).not.toHaveBeenCalled();
      expect(status.latestVersion).toBeNull();
      expect(status.updateAvailable).toBe(false);
    });

    it("degrades gracefully when PyPI is unreachable", async () => {
      axiosGet.mockRejectedValue(new Error("offline"));

      const status = await getYtDlpStatus({ checkLatest: true });

      expect(status.version).toBe("2026.08.19");
      expect(status.latestVersion).toBeNull();
      expect(status.updateAvailable).toBe(false);
    });

    it("marks updates unsupported when YT_DLP_PATH pins a binary", async () => {
      customPathMock.mockReturnValue(true);

      const status = await getYtDlpStatus({ checkLatest: false });

      expect(status.customPathConfigured).toBe(true);
      expect(status.updateSupported).toBe(false);
    });

    it("surfaces the probe error when yt-dlp cannot run", async () => {
      versionProbeMock.mockResolvedValue({
        ...versionInfo(null, false),
        errorMessage: "spawn ENOENT",
      });

      const status = await getYtDlpStatus({ checkLatest: false });

      expect(status.available).toBe(false);
      expect(status.errorMessage).toBe("spawn ENOENT");
    });
  });

  describe("updateYtDlp", () => {
    it("upgrades and reports the version change", async () => {
      versionProbeMock
        .mockResolvedValueOnce(versionInfo("2026.06.09"))
        .mockResolvedValue(versionInfo("2026.08.19"));

      const result = await updateYtDlp();

      expect(installMock).toHaveBeenCalledWith({ upgrade: true, currentIsUsable: true });
      expect(result.previousVersion).toBe("2026.06.09");
      expect(result.status.version).toBe("2026.08.19");
      expect(result.changed).toBe(true);
      expect(axiosGet).not.toHaveBeenCalled();
    });

    it("reports no change when the version stays the same", async () => {
      const result = await updateYtDlp();

      expect(result.changed).toBe(false);
      expect(result.previousVersion).toBe("2026.08.19");
    });

    it("shares one pip run between concurrent callers", async () => {
      let releaseInstall: () => void = () => {};
      const installGate = new Promise<{ published: boolean }>((resolve) => {
        releaseInstall = () => resolve({ published: true });
      });
      installMock.mockReturnValue(installGate);

      const first = updateYtDlp();
      const second = updateYtDlp();
      releaseInstall();
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(installMock).toHaveBeenCalledTimes(1);
      expect(firstResult).toBe(secondResult);
    });

    it("propagates the failure and lets the next call retry", async () => {
      installMock.mockRejectedValueOnce(new Error("pip missing"));

      await expect(updateYtDlp()).rejects.toThrow("pip missing");

      installMock.mockResolvedValueOnce({ published: true });
      await expect(updateYtDlp()).resolves.toMatchObject({ changed: false });
    });
  });
});
