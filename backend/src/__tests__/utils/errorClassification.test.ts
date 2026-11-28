import { describe, expect, it } from "vitest";
import {
  getYtDlpFailureReason,
  isMembersOnlyError,
} from "../../utils/ytdlp/errorClassification";
import { YtDlpExecutionError } from "../../utils/ytdlp/execute";

describe("isMembersOnlyError", () => {
  it("detects the members-only content error from stderr", () => {
    const error = new YtDlpExecutionError("yt-dlp process exited with code 1", {
      stderr:
        "ERROR: [youtube] v8INHztfIzs: Join this channel to get access to members-only content like this video, and other exclusive perks.\n",
      code: 1,
    });

    expect(isMembersOnlyError(error)).toBe(true);
  });

  it("detects the tiered members-only error from stderr", () => {
    const error = new YtDlpExecutionError("yt-dlp process exited with code 1", {
      stderr:
        "ERROR: [youtube] xbxWkOmaqfU: This video is available to this channel's members on level: LTT Members Plus (or any higher level). Join this channel to get access to members-only content and other exclusive perks.\n",
      code: 1,
    });

    expect(isMembersOnlyError(error)).toBe(true);
  });

  it("detects the members-only text carried in the error message", () => {
    expect(
      isMembersOnlyError(
        new Error("Join this channel to get access to members-only content")
      )
    ).toBe(true);
  });

  it("detects a plain string containing the members-only text", () => {
    expect(isMembersOnlyError("members-only content")).toBe(true);
  });

  it("unwraps a nested cause / originalError", () => {
    const inner = new YtDlpExecutionError("boom", {
      stderr: "members on level: Tier 1",
    });
    const wrapper = Object.assign(new Error("Download failed"), {
      originalError: inner,
    });

    expect(isMembersOnlyError(wrapper)).toBe(true);
  });

  it("returns false for unrelated yt-dlp failures", () => {
    const error = new YtDlpExecutionError("yt-dlp process exited with code 1", {
      stderr: "ERROR: [youtube] abc: Video unavailable\n",
      code: 1,
    });

    expect(isMembersOnlyError(error)).toBe(false);
  });

  it("returns false for null / undefined / empty input", () => {
    expect(isMembersOnlyError(null)).toBe(false);
    expect(isMembersOnlyError(undefined)).toBe(false);
    expect(isMembersOnlyError("")).toBe(false);
    expect(isMembersOnlyError(new Error(""))).toBe(false);
  });
});

describe("getYtDlpFailureReason", () => {
  const geoBlockedStderr =
    "ERROR: [youtube] WTbGSD_UHZk: The uploader has not made this video available in your country\n" +
    "This video is available in Poland.\n" +
    "You might want to use a VPN or a proxy server (with --proxy) to workaround.\n";

  it("returns the ERROR line without its prefix and extractor id", () => {
    expect(getYtDlpFailureReason(geoBlockedStderr)).toBe(
      "The uploader has not made this video available in your country"
    );
  });

  it("uses the last ERROR line, including one after a progress carriage return", () => {
    const stderr =
      "ERROR: first attempt failed\n" +
      "[download]  45.0% of 10.00MiB\rERROR: unable to download video data: HTTP Error 404: Not Found\n";

    expect(getYtDlpFailureReason(stderr)).toBe(
      "unable to download video data: HTTP Error 404: Not Found"
    );
  });

  it("keeps text that only looks like an id when there is no extractor tag", () => {
    expect(
      getYtDlpFailureReason("ERROR: Unsupported URL: https://example.com/video\n")
    ).toBe("Unsupported URL: https://example.com/video");
  });

  it("returns null when stderr has no ERROR line", () => {
    expect(getYtDlpFailureReason("")).toBeNull();
    expect(
      getYtDlpFailureReason("WARNING: [youtube] abc: some warning\nfatal error\n")
    ).toBeNull();
    expect(getYtDlpFailureReason("ERROR: [youtube] abc: \n")).toBeNull();
  });

  it("caps a long reason at 300 characters", () => {
    const reason = getYtDlpFailureReason(`ERROR: ${"x".repeat(1000)}\n`);

    expect(reason).toHaveLength(300);
    expect(reason?.endsWith("…")).toBe(true);
  });

  it("drops a line that carries proxy credentials", () => {
    const stderr =
      "ERROR: [youtube] abc: Unable to download webpage: Unable to connect to proxy http://alice:s3cret@proxy.example:8080 (caused by ProxyError)\n";

    expect(getYtDlpFailureReason(stderr)).toBeNull();
  });

  it("drops a line that echoes a URL with a query string, such as a signed URL", () => {
    expect(
      getYtDlpFailureReason(
        "ERROR: Unsupported URL: https://cdn.example/video.mp4?Signature=abc123&Policy=xyz\n"
      )
    ).toBeNull();
  });

  it("drops a line that carries a local path, such as the cookies file", () => {
    expect(
      getYtDlpFailureReason(
        "ERROR: '/app/data/cookies.txt' does not look like a Netscape format cookies file\n"
      )
    ).toBeNull();
    expect(
      getYtDlpFailureReason(
        "ERROR: unable to open for writing: [Errno 13] Permission denied: C:\\mytube\\video.mp4\n"
      )
    ).toBeNull();
    expect(
      getYtDlpFailureReason(
        "ERROR: unable to open for writing: Permission denied: C:/Users/alice/video.mp4\n"
      )
    ).toBeNull();
    expect(
      getYtDlpFailureReason(
        "ERROR: unable to open for writing: Permission denied: \\\\nas\\share\\video.mp4\n"
      )
    ).toBeNull();
    expect(
      getYtDlpFailureReason(
        "ERROR: unable to open for writing: Permission denied: '/媒体/alice/video.mp4'\n"
      )
    ).toBeNull();
  });

  it("uses no line when the proxy's credentials would be split by a parser", () => {
    const stderr = "ERROR: Failed to parse: 'alice:pa' is not a valid host or port\n";

    expect(getYtDlpFailureReason(stderr, "http://alice:pa#ss@proxy.example:8080")).toBeNull();
    expect(getYtDlpFailureReason(stderr, "alice:pa/ss@proxy.example:8080")).toBeNull();
    // Well-formed credentials can't be split, so the line is used.
    expect(
      getYtDlpFailureReason(geoBlockedStderr, "http://alice:s3cret@proxy.example:8080")
    ).toBe("The uploader has not made this video available in your country");
    expect(getYtDlpFailureReason(geoBlockedStderr, "")).toBe(
      "The uploader has not made this video available in your country"
    );
  });

  it("keeps a line whose only slashes belong to URLs", () => {
    const stderr =
      "ERROR: [youtube] abc: Sign in to confirm you're not a bot. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ for help\n";

    expect(getYtDlpFailureReason(stderr)).toBe(
      "Sign in to confirm you're not a bot. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ for help"
    );
  });

  it("drops a line that would be read as a cancellation", () => {
    expect(
      getYtDlpFailureReason("ERROR: [twitch] abc: This stream was cancelled\n")
    ).toBeNull();
  });
});
