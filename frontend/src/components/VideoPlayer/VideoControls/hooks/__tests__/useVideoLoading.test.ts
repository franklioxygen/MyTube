import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoLoading } from "../useVideoLoading";

const mockT = vi.fn((key: string) => key);
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
const originalUserAgent = navigator.userAgent;

vi.mock("../../../../../contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: mockT }),
}));

const setUserAgent = (value: string) => {
  Object.defineProperty(window.navigator, "userAgent", {
    value,
    configurable: true,
  });
};

const createVideoErrorEvent = (
  error: { code: number; message: string } | null,
  src = "movie.mp4",
) =>
  ({
    currentTarget: {
      error,
      src,
    },
  }) as React.SyntheticEvent<HTMLVideoElement>;

describe("useVideoLoading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    mockT.mockImplementation((key: string) => {
      switch (key) {
        case "videoLoadTimeout":
          return "translated timeout";
        case "videoLoadNetworkError":
          return "translated network error";
        default:
          return key;
      }
    });
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    );
  });

  afterEach(() => {
    setUserAgent(originalUserAgent);
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it("uses a translated timeout message", () => {
    const { result } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.startLoading();
      vi.advanceTimersByTime(30000);
    });

    expect(result.current.loadError).toBe("translated timeout");
    expect(mockT).toHaveBeenCalledWith("videoLoadTimeout");
  });

  it("uses a translated video network error message", () => {
    const { result } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.handleVideoError({
        currentTarget: {
          error: { code: 2, message: "network down" },
          src: "movie.mp4",
        },
      } as any);
    });

    expect(result.current.loadError).toBe("translated network error");
    expect(mockT).toHaveBeenCalledWith("videoLoadNetworkError");
  });

  it("clears pending timeouts when loading is restarted and stopped", () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.startLoading();
      result.current.startLoading();
    });

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.stopLoading();
      vi.advanceTimersByTime(30000);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadError).toBeNull();
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
  });

  it("stores a custom error and clears any active timeout", () => {
    const { result } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.startLoading();
      result.current.setError("custom error");
      vi.advanceTimersByTime(30000);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadError).toBe("custom error");
  });

  it("clears a pending timeout on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result, unmount } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.startLoading();
    });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("maps aborted video errors to the translated message", () => {
    const { result } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.handleVideoError(
        createVideoErrorEvent({ code: 1, message: "aborted by user" }),
      );
    });

    expect(result.current.loadError).toBe("videoLoadingAborted");
  });

  it("uses the default translated error when the browser exposes an unknown media error code", () => {
    const { result } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.handleVideoError(
        createVideoErrorEvent({ code: 99, message: "mystery failure" }),
      );
    });

    expect(result.current.loadError).toBe("failedToLoadVideo");
  });

  it("ignores video error events that do not expose media error details", () => {
    const { result } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.handleVideoError(createVideoErrorEvent(null));
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it("uses Safari-specific decode messages for webm and non-webm sources", () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    );
    const { result } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.handleVideoError(
        createVideoErrorEvent({ code: 3, message: "decode failed" }, "clip.webm"),
      );
    });

    expect(result.current.loadError).toBe("safariWebmLimitedSupportError");

    act(() => {
      result.current.handleVideoError(
        createVideoErrorEvent({ code: 3, message: "decode failed" }, "clip.mp4"),
      );
    });

    expect(result.current.loadError).toBe("safariVideoDecodeError");
  });

  it("uses browser-specific decode and format messages outside Safari", () => {
    const { result } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.handleVideoError(
        createVideoErrorEvent({ code: 3, message: "decode failed" }),
      );
    });

    expect(result.current.loadError).toBe("videoDecodeError");

    act(() => {
      result.current.handleVideoError(
        createVideoErrorEvent({ code: 4, message: "format not supported" }),
      );
    });

    expect(result.current.loadError).toBe("browserVideoFormatNotSupported");
  });

  it("uses Safari-specific format messages when the source is unsupported", () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    );
    const { result } = renderHook(() => useVideoLoading());

    act(() => {
      result.current.handleVideoError(
        createVideoErrorEvent({ code: 4, message: "format not supported" }),
      );
    });

    expect(result.current.loadError).toBe("safariVideoFormatNotSupported");
  });
});
