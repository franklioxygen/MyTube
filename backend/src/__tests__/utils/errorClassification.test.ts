import { describe, expect, it } from "vitest";
import { isMembersOnlyError } from "../../utils/ytdlp/errorClassification";
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
