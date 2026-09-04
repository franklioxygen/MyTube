import { afterEach, describe, expect, it, vi } from "vitest";
import { captureProcessEnv } from "../../utils/ytdlp/release/env";
import { getProxyBypassHosts } from "../../utils/ytdlp/config";

vi.mock("../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderPluginPath: vi.fn(() => ""),
  getProviderScript: vi.fn(() => ""),
}));

vi.mock("../../utils/ytdlp/config", () => ({
  getProxyBypassHosts: vi.fn(() => []),
}));

const mockedBypassHosts = vi.mocked(getProxyBypassHosts);

/**
 * yt-dlp inherits HTTP_PROXY/HTTPS_PROXY from this process and applies them to
 * every request it makes, one per HLS fragment included. NO_PROXY is the only
 * lever that discriminates per request host, so the configured bypass list has
 * to reach the child through the spawn environment (issue #446).
 */
describe("captureProcessEnv proxy bypass", () => {
  afterEach(() => {
    mockedBypassHosts.mockReset();
    mockedBypassHosts.mockReturnValue([]);
  });

  it("leaves the environment untouched when nothing is configured", () => {
    mockedBypassHosts.mockReturnValue([]);

    const env = captureProcessEnv({ NO_PROXY: "localhost", PATH: "/usr/bin" });

    expect(env.NO_PROXY).toBe("localhost");
    expect(env.no_proxy).toBeUndefined();
  });

  it("appends the configured hosts to an existing NO_PROXY", () => {
    mockedBypassHosts.mockReturnValue(["surrit.com"]);

    const env = captureProcessEnv({ NO_PROXY: "localhost,127.0.0.1" });

    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,surrit.com");
  });

  it("lets a lowercase no_proxy override the uppercase spelling", () => {
    mockedBypassHosts.mockReturnValue(["surrit.com"]);

    // CPython's getproxies_environment() reads the environment twice and the
    // second pass matches lowercase names only, so no_proxy is authoritative
    // whatever order the variables come in. A union would bypass localhost too.
    const env = captureProcessEnv({ NO_PROXY: "localhost", no_proxy: "mihomo" });

    expect(env.NO_PROXY).toBe("mihomo,surrit.com");
    expect(env.no_proxy).toBe(env.NO_PROXY);
  });

  it("does not resurrect an uppercase list that an empty no_proxy cleared", () => {
    mockedBypassHosts.mockReturnValue(["surrit.com"]);

    // An empty lowercase value makes that second pass *remove* the bypass list.
    // Setting `no_proxy=` is how a deployment clears a NO_PROXY it inherited
    // from a base image, so those hosts must not come back as bypasses here.
    const env = captureProcessEnv({ NO_PROXY: "a.com,b.com", no_proxy: "" });

    expect(env.NO_PROXY).toBe("surrit.com");
    expect(env.no_proxy).toBe(env.NO_PROXY);
  });

  it("writes both spellings so neither reader sees a stale list", () => {
    mockedBypassHosts.mockReturnValue(["surrit.com"]);

    const env = captureProcessEnv({ NO_PROXY: "localhost" });

    expect(env.NO_PROXY).toBe("localhost,surrit.com");
    expect(env.no_proxy).toBe(env.NO_PROXY);
  });

  it("does not duplicate a host the environment already lists", () => {
    mockedBypassHosts.mockReturnValue(["surrit.com", "example.com"]);

    const env = captureProcessEnv({ NO_PROXY: "surrit.com" });

    expect(env.NO_PROXY).toBe("surrit.com,example.com");
  });

  it("keeps the inherited configuration when the settings cannot be read", () => {
    mockedBypassHosts.mockImplementation(() => {
      throw new Error("settings unavailable");
    });

    // A spawn environment is not the place to fail an operation.
    expect(captureProcessEnv({ NO_PROXY: "localhost" }).NO_PROXY).toBe(
      "localhost"
    );
  });

  it("does not mutate the source environment", () => {
    mockedBypassHosts.mockReturnValue(["surrit.com"]);
    const source = { NO_PROXY: "localhost" };

    captureProcessEnv(source);

    expect(source).toEqual({ NO_PROXY: "localhost" });
  });
});
