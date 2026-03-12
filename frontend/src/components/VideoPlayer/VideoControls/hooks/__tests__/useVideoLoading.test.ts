import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoLoading } from "../useVideoLoading";

const mockT = vi.fn((key: string) => key);
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

vi.mock("../../../../../contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: mockT }),
}));

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
  });

  afterEach(() => {
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
});
