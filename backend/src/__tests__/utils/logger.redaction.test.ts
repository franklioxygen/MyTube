import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger, LogLevel, redactSensitive } from "../../utils/logger";
import { InvalidProxyError } from "../../utils/ytdlp/proxy";

const PASSWORD = "s3cr3t-pw";
const LONG = "a".repeat(1000);

// [form, input, redacted]
const URLS_WITH_CREDENTIALS: Array<[string, string, string]> = [
  [
    "http with a password",
    "http://user:pass@host:1",
    "http://[REDACTED]@host:1",
  ],
  [
    "socks with an unencoded %",
    "socks5h://user:100%@host:1",
    "socks5h://[REDACTED]@host:1",
  ],
  [
    "an unencoded @ in the password",
    "http://user:p@ss@host:1",
    "http://[REDACTED]@host:1",
  ],
  [
    "an unencoded / in the password",
    "http://user:p/w@host:1",
    "http://[REDACTED]@host:1",
  ],
  [
    "an unencoded ? in the password",
    "http://user:p?w@host:1",
    "http://[REDACTED]@host:1",
  ],
  [
    "an unencoded # in the password",
    "http://user:p#w@host:1",
    "http://[REDACTED]@host:1",
  ],
  [
    "a space in the password",
    "http://user:pa ss@host:1",
    "http://[REDACTED]@host:1",
  ],
  [
    "a password that starts with digits",
    "http://user:123/w@host:1",
    "http://[REDACTED]@host:1",
  ],
  [
    "both / and @ in the password",
    "http://user:p/w@ss/x@host:1",
    "http://[REDACTED]@host:1",
  ],
  [
    "an @ in the username",
    "http://us@er:p/w@host:1",
    "http://[REDACTED]@host:1",
  ],
  ["no password", "http://user@host:1", "http://[REDACTED]@host:1"],
  ["an IPv6 host", "http://user:pw@[::1]:1", "http://[REDACTED]@[::1]:1"],
  ["an uppercase scheme", "HTTP://user:pw@host:1", "HTTP://[REDACTED]@host:1"],
  ["no scheme", "user:pw@host:1", "[REDACTED]@host:1"],
  ["only slashes for a scheme", "//user:pw@host:1", "[REDACTED]@host:1"],
  ["no scheme and an unencoded /", "user:p/w@host:1", "[REDACTED]@host:1"],
  ["no scheme and an unencoded @", "user:p@ss@host:1", "[REDACTED]@host:1"],
  [
    "a URL inside a sentence",
    "Using proxy http://user:pw@host:1 for download",
    "Using proxy http://[REDACTED]@host:1 for download",
  ],
  [
    "no scheme inside a sentence",
    "Using proxy user:pw@host:1 for download",
    "Using proxy [REDACTED]@host:1 for download",
  ],
  [
    "a prefix that is not a scheme character",
    "--http://user:pw@host:1",
    "--http://[REDACTED]@host:1",
  ],
  [
    "a URL as a query value",
    "https://a.com/?proxy=http://user:pw@host:1",
    "https://a.com/?proxy=http://[REDACTED]@host:1",
  ],
  ["a long password", `http://user:${LONG}@host:1`, "http://[REDACTED]@host:1"],
  [
    "a long password with an unencoded /",
    `http://user:${LONG}/w@host:1`,
    "http://[REDACTED]@host:1",
  ],
  [
    "a long password with an unencoded ?",
    `http://user:${LONG}?w@host:1`,
    "http://[REDACTED]@host:1",
  ],
  [
    "a long password with an unencoded #",
    `http://user:${LONG}#w@host:1`,
    "http://[REDACTED]@host:1",
  ],
  [
    "a long password with a space",
    `http://user:${LONG} w@host:1`,
    "http://[REDACTED]@host:1",
  ],
  ["no scheme and a long password", `user:${LONG}@host:1`, "[REDACTED]@host:1"],
  [
    "no scheme and a long password with an unencoded /",
    `user:${LONG}/w@host:1`,
    "[REDACTED]@host:1",
  ],
  [
    "only slashes for a scheme and a long password",
    `//user:${LONG}@host:1`,
    "[REDACTED]@host:1",
  ],
];

const TEXT_LEFT_UNCHANGED = [
  "https://www.tiktok.com/@user",
  "https://www.youtube.com/@channel/videos",
  "https://host/path?email=a@b.com",
  "https://host/path#a@b",
  "https://i0.hdslb.com/bfs/archive/abc.jpg@672w_378h_1c.webp",
  "//i0.hdslb.com/bfs/archive/abc.jpg@100w.webp",
  "https://host/a:b@c.png",
  "http://[::1]:8080/@user",
  "Referer:https://www.tiktok.com/@user",
  "http://host:8080 seen by a@b.com",
  "http://host:8080/path seen by a@b.com",
  "Failed to reach http://host: refused for a@b.com",
  "user@example.com",
  "Author: user@example.com",
  "git@github.com:owner/repo.git",
  "http://127.0.0.1:7890",
  "[yt-dlp] spawning release=external:yt-dlp:2099.03.17 version=2099.03.17",
];

describe("redactSensitive URL credentials", () => {
  it.each(URLS_WITH_CREDENTIALS)(
    "should redact %s",
    (_form, input, redacted) => {
      expect(redactSensitive(input)).toBe(redacted);
    }
  );

  it.each(URLS_WITH_CREDENTIALS)(
    "should not change the already redacted form of %s",
    (_form, input) => {
      // bilibiliVideoHelpers runs its own URL redaction and then this one.
      const once = redactSensitive(input);
      expect(redactSensitive(once)).toBe(once);
    }
  );

  it.each(TEXT_LEFT_UNCHANGED)("should leave %s unchanged", (text) => {
    expect(redactSensitive(text)).toBe(text);
  });

  it.each([
    ["http://user:pw@host:1,https://other.com"],
    ['{"proxy":"http://user:pw@host:1","url":"https://other.com"}'],
    ["user:pw@host:1,https://other.com"],
  ])("should not leak when more text follows in the token: %s", (text) => {
    expect(redactSensitive(text)).not.toContain("pw");
  });

  it.each([
    ["no @", "://:".repeat(50_000)],
    ["an @ past the repeats", `x://y:z@${"://:".repeat(50_000)}`],
    ["an @ in a later token", `${"://:".repeat(50_000)} a@b`],
    ["spaces and no @", "://:a ".repeat(50_000)],
    ["spaces and an @ on a later line", `${"://:a ".repeat(50_000)}\na@b`],
  ])("should stay fast on a long line with %s", (_shape, text) => {
    const start = performance.now();
    redactSensitive(text);

    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("should accept over-redacting a link with a port and an @ in its path", () => {
    // Indistinguishable from `http://user:8080/@host`, and the worse mistake
    // would be printing a password.
    expect(redactSensitive("https://host:8443/@user")).toBe(
      "https://[REDACTED]@user"
    );
  });

  it.each([
    ["password", "password:abc@def"],
    ["token", "token:abc@def"],
    ["secret", "secret:abc@def"],
  ])("should keep redacting the whole %s value", (name, text) => {
    const redacted = redactSensitive(text);

    expect(redacted).toBe(`${name}=[REDACTED]`);
    expect(redacted).not.toContain("def");
  });
});

describe("Logger output with URL credentials", () => {
  const PROXY_URL = `http://user:${PASSWORD}@host:1`;
  let written: string[];

  const capture = (chunk: unknown): boolean => {
    written.push(String(chunk));
    return true;
  };

  beforeEach(() => {
    written = [];
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
      written.push(args.map((arg) => JSON.stringify(arg)).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const logAtEveryLevel = (...args: unknown[]): string => {
    const logger = new Logger(LogLevel.DEBUG);
    logger.debug("logged:", ...args);
    logger.info("logged:", ...args);
    logger.warn("logged:", ...args);
    logger.error("logged:", ...args);
    return written.join("\n");
  };

  it.each<[string, unknown]>([
    ["a raw proxy string", PROXY_URL],
    ["a flags object", { proxy: PROXY_URL, format: "best" }],
    ["a nested object", { network: { flags: { proxy: PROXY_URL } } }],
    ["an array", ["--proxy", PROXY_URL]],
    ["an array inside an object", { args: ["--proxy", PROXY_URL] }],
    ["an object inside an array", [{ proxy: PROXY_URL }]],
    ["an error", new Error(`connect failed via ${PROXY_URL}`)],
    ["a URL object", new URL(PROXY_URL)],
  ])("should not print the password from %s", (_shape, value) => {
    const output = logAtEveryLevel(value);

    expect(output).toContain("[REDACTED]@host:1");
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain("user:");
  });

  it("should not print the password from the message itself", () => {
    const logger = new Logger(LogLevel.DEBUG);
    logger.debug(`Using ${PROXY_URL}`);
    logger.info(`Using ${PROXY_URL}`);
    logger.warn(`Using ${PROXY_URL}`);
    logger.error(`Using ${PROXY_URL}`);

    expect(written).toHaveLength(4);
    expect(written.join("\n")).not.toContain(PASSWORD);
  });

  it("should not print the password from an object it cannot serialize", () => {
    const circular: Record<string, unknown> = { proxy: PROXY_URL };
    circular.self = circular;

    expect(logAtEveryLevel(circular)).not.toContain(PASSWORD);
    expect(written).toHaveLength(4);
  });

  it("should not print the password from an array it cannot serialize", () => {
    const output = logAtEveryLevel([PROXY_URL, BigInt(1)]);

    expect(output).toContain("[REDACTED]@host:1");
    expect(output).not.toContain(PASSWORD);
    expect(written).toHaveLength(4);
  });

  it("should not throw on an object it cannot turn into a string", () => {
    const value = Object.assign(Object.create(null), { big: BigInt(1) });

    expect(logAtEveryLevel(value)).toContain("[unserializable]");
    expect(written).toHaveLength(4);
  });

  it("should not print the password from InvalidProxyError output", () => {
    const output = logAtEveryLevel(
      new InvalidProxyError(`ftp://user:${PASSWORD}@host:2121`)
    );

    expect(output).toContain("Invalid proxy URL: ftp://host:2121");
    expect(output).not.toContain(PASSWORD);
  });

  it("should keep the structure of what it redacts", () => {
    new Logger(LogLevel.INFO).info("flags:", {
      proxy: PROXY_URL,
      addHeader: ["Referer:https://www.tiktok.com/@user"],
      retries: 3,
    });

    expect(written.join("")).toContain(
      '{"proxy":"http://[REDACTED]@host:1","addHeader":["Referer:https://www.tiktok.com/@user"],"retries":3}'
    );
  });
});
