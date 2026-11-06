import { inspect } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocksProxyAgent } from "socks-proxy-agent";
import { getAxiosProxyConfig, InvalidProxyError } from "../../utils/ytdlp/proxy";

// socks-proxy-agent is deliberately not mocked: its strict credential decoding
// is half of what these tests are about.

const USERNAME = "alice-proxy-user";
const PASSWORD = "s3cr3t-proxy-pw";

// [what is wrong with it, rejected URL, the text it is reduced to]
const REJECTED_URLS: Array<[string, string, string]> = [
  [
    "an unsupported scheme",
    `ftp://${USERNAME}:${PASSWORD}@proxy.example.com:2121`,
    "ftp://proxy.example.com:2121",
  ],
  [
    "an unsupported scheme with a socks prefix",
    `socksfoo://${USERNAME}:${PASSWORD}@proxy.example.com:1080`,
    "socksfoo://proxy.example.com:1080",
  ],
  [
    "an invalid port",
    `http://${USERNAME}:${PASSWORD}@proxy.example.com:notaport`,
    "[redacted]",
  ],
  [
    "an unencoded slash in the password",
    `http://${USERNAME}:${PASSWORD}/x@proxy.example.com:8080`,
    "[redacted]",
  ],
  [
    "no scheme, so the username parses as one",
    `${USERNAME}:${PASSWORD}@proxy.example.com:8080`,
    "[redacted]",
  ],
  [
    "no slashes after a non-special scheme",
    `socks5:${USERNAME}:${PASSWORD}@proxy.example.com`,
    "[redacted]",
  ],
  [
    "no host, so the password parses as a port",
    `http://${USERNAME}:${PASSWORD}`,
    "[redacted]",
  ],
];

// [raw credential, what yt-dlp would send], matching Python's unquote.
const UNQUOTE_CASES: Array<[string, string]> = [
  ["100%", "100%"],
  ["a%41%", "aA%"],
  ["%", "%"],
  ["%4", "%4"],
  ["%zz", "%zz"],
  ["%25", "%"],
  ["%2541", "%41"],
  ["%C3%A4", "ä"],
  ["%FF", "�"],
  ["%E2%82%%AC", "�%�"],
  ["a+b", "a+b"],
  ["plain", "plain"],
];

describe("getAxiosProxyConfig credentials", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    const capture = (chunk: unknown): boolean => {
      logged.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const rejectionOf = (proxyUrl: string): InvalidProxyError => {
    try {
      getAxiosProxyConfig(proxyUrl);
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidProxyError);
      return error as InvalidProxyError;
    }
    throw new Error(`Expected ${proxyUrl} to be rejected`);
  };

  describe("rejected URLs", () => {
    it.each(REJECTED_URLS)(
      "should not expose credentials for %s",
      (_description, proxyUrl, redacted) => {
        const error = rejectionOf(proxyUrl);

        expect(error.message).toBe(`Invalid proxy URL: ${redacted}`);
        expect(error.proxyUrl).toBe(redacted);

        const exposedText = [
          error.message,
          error.proxyUrl,
          error.stack,
          error.originalError?.message,
          error.originalError?.stack,
          JSON.stringify(error),
          inspect(error, { depth: null, showHidden: true }),
          ...logged,
        ].join("\n");
        expect(exposedText).not.toContain(PASSWORD);
        expect(exposedText).not.toContain(USERNAME);
      }
    );

    it("should actually log a URL it cannot parse, without the password", () => {
      // Guards the assertions above: if nothing reached the captured streams,
      // "the password is not in the log" would pass without testing anything.
      rejectionOf(`http://${USERNAME}:${PASSWORD}@proxy.example.com:notaport`);

      const logText = logged.join("");
      expect(logText).toContain("Invalid proxy URL: [redacted]");
      expect(logText).toContain("Invalid URL");
      expect(logText).not.toContain(PASSWORD);
    });

    it("should keep the reason but not the URL held by Node's URL error", () => {
      const { originalError } = rejectionOf(
        `http://${USERNAME}:${PASSWORD}@proxy.example.com:notaport`
      );

      expect(originalError?.name).toBe("TypeError");
      expect(originalError?.message).toBe("Invalid URL");
      expect(originalError).not.toHaveProperty("input");
    });

    it("should redact when the error is constructed directly", () => {
      const urlError = new TypeError("Invalid URL");
      Object.assign(urlError, { input: `http://u:${PASSWORD}@h` });

      const error = new InvalidProxyError(
        `http://u:${PASSWORD}@proxy.example.com:8080`,
        urlError
      );

      expect(error.proxyUrl).toBe("http://proxy.example.com:8080");
      expect(inspect(error, { depth: null })).not.toContain(PASSWORD);
    });
  });

  describe("unencoded % in HTTP proxy credentials", () => {
    it("should send the password from the original report as yt-dlp does", () => {
      const config = getAxiosProxyConfig("http://user:100%@127.0.0.1:1");

      expect(config).toEqual({
        proxy: {
          protocol: "http",
          host: "127.0.0.1",
          port: 1,
          auth: { username: "user", password: "100%" },
        },
      });
      expect(logged.join("")).not.toContain("100%");
    });

    it.each(UNQUOTE_CASES)("should decode %s like unquote", (raw, expected) => {
      const { proxy } = getAxiosProxyConfig(
        `https://${raw}:${raw}@proxy.example.com:8443`
      );

      expect(proxy.auth).toEqual({ username: expected, password: expected });
    });

    it("should decode characters the URL parser escapes on its own", () => {
      const { proxy } = getAxiosProxyConfig(
        "http://us er:pä ss%@proxy.example.com:8080"
      );

      expect(proxy.auth).toEqual({ username: "us er", password: "pä ss%" });
    });
  });

  describe("unencoded % in SOCKS proxy credentials", () => {
    const agentFor = (proxyUrl: string): SocksProxyAgent => {
      const config = getAxiosProxyConfig(proxyUrl);
      expect(config.proxy).toBe(false);
      expect(config.httpsAgent).toBe(config.httpAgent);
      expect(config.httpAgent).toBeInstanceOf(SocksProxyAgent);
      return config.httpAgent;
    };

    it.each(UNQUOTE_CASES)(
      "should give the agent %s decoded like unquote",
      (raw, expected) => {
        const { proxy } = agentFor(`socks5://${raw}:${raw}@127.0.0.1:1080`);

        expect(proxy.userId).toBe(expected);
        expect(proxy.password).toBe(expected);
      }
    );

    it.each([
      ["socks5", 5, false],
      ["socks5h", 5, false],
      ["socks", 5, false],
      ["socks4", 4, true],
      ["socks4a", 4, false],
    ])(
      "should accept %s with an unencoded %% and keep its DNS mode",
      (scheme, type, shouldLookup) => {
        const agent = agentFor(`${scheme}://user:100%@127.0.0.1:1080`);

        expect(agent.proxy).toMatchObject({
          host: "127.0.0.1",
          port: 1080,
          type,
        });
        expect(agent.proxy.password).toBe("100%");
        expect(agent.shouldLookup).toBe(shouldLookup);
      }
    );

    it("should leave credentials out when there are none", () => {
      const { proxy } = agentFor("socks5://127.0.0.1:1080");

      expect(proxy.userId).toBeUndefined();
      expect(proxy.password).toBe("");
    });
  });
});
