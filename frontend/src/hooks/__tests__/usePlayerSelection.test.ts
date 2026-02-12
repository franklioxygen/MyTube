/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerSelection } from "../usePlayerSelection";

const mockShowSnackbar = vi.fn();
const mockIncrementView = vi.fn();
const mockT = vi.fn((key: string) => key);
const mockGetAvailablePlayers = vi.fn(() => [{ id: "vlc", name: "VLC" }]);
const mockGetPlayerUrl = vi.fn((player: string, url: string) => `${player}://${url}`);

vi.mock("../../contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: mockT }),
}));

vi.mock("../../contexts/SnackbarContext", () => ({
  useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));

vi.mock("../../contexts/VideoContext", () => ({
  useVideo: () => ({ incrementView: mockIncrementView }),
}));

vi.mock("../../utils/playerUtils", () => ({
  getAvailablePlayers: () => mockGetAvailablePlayers(),
  getPlayerUrl: (player: string, url: string) => mockGetPlayerUrl(player, url),
}));

describe("usePlayerSelection", () => {
  const video = { id: "video-1", title: "Video" } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, "execCommand", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it("returns available players from utility", () => {
    const { result } = renderHook(() =>
      usePlayerSelection({
        video,
        getVideoUrl: vi.fn().mockResolvedValue("https://video.test"),
      })
    );

    expect(result.current.getAvailablePlayers()).toEqual([{ id: "vlc", name: "VLC" }]);
    expect(mockGetAvailablePlayers).toHaveBeenCalledTimes(1);
  });

  it("shows error when resolved video URL is empty", async () => {
    const { result } = renderHook(() =>
      usePlayerSelection({
        video,
        getVideoUrl: vi.fn().mockResolvedValue(""),
      })
    );

    act(() => {
      result.current.setPlayerMenuAnchor(document.createElement("button"));
    });

    await act(async () => {
      await result.current.handlePlayerSelect("vlc");
    });

    expect(mockShowSnackbar).toHaveBeenCalledWith("error", "error");
    expect(mockIncrementView).not.toHaveBeenCalled();
    expect(result.current.playerMenuAnchor).toBeNull();
  });

  it("copies URL via clipboard when copy action succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { result } = renderHook(() =>
      usePlayerSelection({
        video,
        getVideoUrl: vi.fn().mockResolvedValue("https://video.test"),
      })
    );

    await act(async () => {
      await result.current.handlePlayerSelect("copy");
    });

    expect(mockIncrementView).toHaveBeenCalledWith("video-1");
    expect(writeText).toHaveBeenCalledWith("https://video.test");
    expect(mockShowSnackbar).toHaveBeenCalledWith("linkCopied", "success");
    expect(result.current.playerMenuAnchor).toBeNull();
  });

  it("shows copy failure when clipboard API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("copy failed"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { result } = renderHook(() =>
      usePlayerSelection({
        video,
        getVideoUrl: vi.fn().mockResolvedValue("https://video.test"),
      })
    );

    await act(async () => {
      await result.current.handlePlayerSelect("copy");
    });

    expect(mockShowSnackbar).toHaveBeenCalledWith("copyFailed", "error");
  });

  it("falls back to execCommand copy when clipboard API is unavailable", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });

    const { result } = renderHook(() =>
      usePlayerSelection({
        video,
        getVideoUrl: vi.fn().mockResolvedValue("https://video.test"),
      })
    );

    await act(async () => {
      await result.current.handlePlayerSelect("copy");
    });

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(mockShowSnackbar).toHaveBeenCalledWith("linkCopied", "success");
  });

  it("shows copy failure when fallback execCommand throws", async () => {
    const execCommand = vi.fn(() => {
      throw new Error("exec failed");
    });
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });

    const { result } = renderHook(() =>
      usePlayerSelection({
        video,
        getVideoUrl: vi.fn().mockResolvedValue("https://video.test"),
      })
    );

    await act(async () => {
      await result.current.handlePlayerSelect("copy");
    });

    expect(mockShowSnackbar).toHaveBeenCalledWith("copyFailed", "error");
  });

  it("opens external player URL and shows info snackbar", async () => {
    vi.useFakeTimers();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    mockGetPlayerUrl.mockReturnValueOnce("vlc://https://video.test");

    const { result } = renderHook(() =>
      usePlayerSelection({
        video,
        getVideoUrl: vi.fn().mockResolvedValue("https://video.test"),
      })
    );

    await act(async () => {
      await result.current.handlePlayerSelect("vlc");
    });

    expect(mockIncrementView).toHaveBeenCalledWith("video-1");
    expect(mockGetPlayerUrl).toHaveBeenCalledWith("vlc", "https://video.test");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockShowSnackbar).toHaveBeenCalledWith("openInExternalPlayer", "info");

    clickSpy.mockRestore();
  });

  it("shows copy failure when opening player throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetPlayerUrl.mockImplementationOnce(() => {
      throw new Error("open failed");
    });

    const { result } = renderHook(() =>
      usePlayerSelection({
        video,
        getVideoUrl: vi.fn().mockResolvedValue("https://video.test"),
      })
    );

    await act(async () => {
      await result.current.handlePlayerSelect("vlc");
    });

    expect(mockShowSnackbar).toHaveBeenCalledWith("copyFailed", "error");
    expect(result.current.playerMenuAnchor).toBeNull();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
