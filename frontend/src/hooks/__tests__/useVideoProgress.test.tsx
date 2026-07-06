import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoProgress } from "../useVideoProgress";
import {
  readVideoResumeProgress,
  writeVideoResumeProgress,
} from "../../utils/videoResumeProgress";

const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockSendVideoProgressWithKeepalive = vi.fn();
let mockUserRole = "admin";

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ userRole: mockUserRole }),
}));

vi.mock("../../utils/apiClient", () => ({
  api: {
    post: (...args: any[]) => mockApiPost(...args),
    put: (...args: any[]) => mockApiPut(...args),
  },
  apiClient: {
    defaults: {
      baseURL: "/api",
    },
  },
  sendVideoProgressWithKeepalive: (...args: any[]) =>
    mockSendVideoProgressWithKeepalive(...args),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
};

describe("useVideoProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUserRole = "admin";
    mockApiPost.mockResolvedValue({ data: { success: true, viewCount: 1 } });
    mockApiPut.mockResolvedValue({ data: { success: true } });
    mockSendVideoProgressWithKeepalive.mockReturnValue(true);
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
  });

  it("counts view at 4 seconds for short MM:SS duration and syncs progress cache", async () => {
    let now = 1000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const video = {
      id: "video-1",
      duration: "0:15",
      progress: 0,
      viewCount: 0,
    } as any;
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-1"], video);

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-1", video }),
      { wrapper },
    );

    act(() => {
      result.current.handleTimeUpdate(3);
    });
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockApiPut).not.toHaveBeenCalled();

    now = 7000;
    act(() => {
      result.current.handleTimeUpdate(4);
    });

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/videos/video-1/view");
    });
    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith("/videos/video-1/progress", {
        progress: 4,
      });
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(["videos"])).toEqual([
        expect.objectContaining({
          id: "video-1",
          progress: 4,
          viewCount: 1,
          lastPlayedAt: 7000,
        }),
      ]);
      expect(queryClient.getQueryData(["video", "video-1"])).toEqual(
        expect.objectContaining({
          id: "video-1",
          progress: 4,
          viewCount: 1,
          lastPlayedAt: 7000,
        })
      );
    });

    act(() => {
      result.current.setIsDeleting(true);
    });

    dateNowSpy.mockRestore();
  });

  it("syncs progress writes into the cache before the view threshold is reached", async () => {
    let now = 1000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const video = {
      id: "video-2",
      duration: "120",
      progress: 0,
      viewCount: 0,
    } as any;
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-2"], video);

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-2", video }),
      { wrapper },
    );

    now = 7000;
    act(() => {
      result.current.handleTimeUpdate(5);
    });
    expect(mockApiPost).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith("/videos/video-2/progress", {
        progress: 5,
      });
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(["videos"])).toEqual([
        expect.objectContaining({
          id: "video-2",
          progress: 5,
        }),
      ]);
      expect(queryClient.getQueryData(["video", "video-2"])).toEqual(
        expect.objectContaining({
          id: "video-2",
          progress: 5,
        })
      );
    });
    expect(queryClient.getQueryData(["videos"])).toEqual([
      expect.not.objectContaining({
        lastPlayedAt: expect.anything(),
      }),
    ]);

    act(() => {
      result.current.handleTimeUpdate(10);
    });

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/videos/video-2/view");
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(["videos"])).toEqual([
        expect.objectContaining({
          id: "video-2",
          progress: 5,
          viewCount: 1,
          lastPlayedAt: expect.any(Number),
        }),
      ]);
      expect(queryClient.getQueryData(["video", "video-2"])).toEqual(
        expect.objectContaining({
          id: "video-2",
          progress: 5,
          viewCount: 1,
          lastPlayedAt: expect.any(Number),
        })
      );
    });

    act(() => {
      result.current.setIsDeleting(true);
    });

    dateNowSpy.mockRestore();
  });

  it("sends progress on unmount and keeps the cache resume point fresh", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const video = {
      id: "video-3",
      duration: "120",
      progress: 0,
      viewCount: 0,
    } as any;
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-3"], video);

    const { result, unmount } = renderHook(
      () => useVideoProgress({ videoId: "video-3", video }),
      { wrapper },
    );

    act(() => {
      result.current.handleTimeUpdate(3);
    });

    expect(mockApiPut).not.toHaveBeenCalled();
    expect(mockApiPost).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(mockSendVideoProgressWithKeepalive).toHaveBeenCalledWith(
      "video-3",
      3
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["videos"])).toEqual([
      expect.objectContaining({
        id: "video-3",
        progress: 3,
      }),
    ]);
    expect(queryClient.getQueryData(["video", "video-3"])).toEqual(
      expect.objectContaining({
        id: "video-3",
        progress: 3,
      })
    );
    expect(queryClient.getQueryData(["videos"])).toEqual([
      expect.not.objectContaining({
        lastPlayedAt: expect.anything(),
      }),
    ]);
    expect(queryClient.getQueryData(["video", "video-3"])).not.toHaveProperty(
      "lastPlayedAt"
    );

    dateNowSpy.mockRestore();
  });

  it("samples the media element on unmount when no timeupdate fired", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const video = {
      id: "video-element-unmount",
      duration: "120",
      progress: 0,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      value: 37.8,
    });
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-element-unmount"], video);

    const { unmount } = renderHook(
      () => useVideoProgress({ videoId: "video-element-unmount", video, videoElement }),
      { wrapper },
    );

    act(() => {
      unmount();
    });

    expect(mockSendVideoProgressWithKeepalive).toHaveBeenCalledWith(
      "video-element-unmount",
      37
    );
    expect(queryClient.getQueryData(["videos"])).toEqual([
      expect.objectContaining({
        id: "video-element-unmount",
        progress: 37,
      }),
    ]);
    expect(queryClient.getQueryData(["video", "video-element-unmount"])).toEqual(
      expect.objectContaining({
        id: "video-element-unmount",
        progress: 37,
      })
    );

    dateNowSpy.mockRestore();
  });

  it("flushes sampled media element progress on pagehide", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const video = {
      id: "video-pagehide",
      duration: "120",
      progress: 0,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      value: 42.2,
    });
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-pagehide"], video);

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-pagehide", video, videoElement }),
      { wrapper },
    );

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(mockSendVideoProgressWithKeepalive).toHaveBeenCalledWith(
      "video-pagehide",
      42
    );
    expect(queryClient.getQueryData(["video", "video-pagehide"])).toEqual(
      expect.objectContaining({
        progress: 42,
      })
    );

    act(() => {
      result.current.setIsDeleting(true);
    });

    dateNowSpy.mockRestore();
  });

  it("keeps local resume progress fresh from native media events", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const video = {
      id: "video-native-event",
      duration: "120",
      progress: 0,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      value: 58.6,
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-native-event", video, videoElement }),
      { wrapper },
    );

    act(() => {
      videoElement.dispatchEvent(new Event("playing"));
    });

    expect(readVideoResumeProgress("video-native-event")).toEqual({
      progress: 58,
      updatedAt: 1000,
    });

    act(() => {
      result.current.setIsDeleting(true);
    });

    dateNowSpy.mockRestore();
  });

  it("does not clobber a higher resume point with low native Safari samples before restore is observed", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const video = {
      id: "video-safari-restore",
      duration: "1776",
      progress: 826,
      lastPlayedAt: 900,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      writable: true,
      value: 5,
    });
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-safari-restore"], video);

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-safari-restore", video, videoElement }),
      { wrapper },
    );

    act(() => {
      videoElement.dispatchEvent(new Event("timeupdate"));
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(mockSendVideoProgressWithKeepalive).toHaveBeenCalledWith(
      "video-safari-restore",
      826
    );
    expect(readVideoResumeProgress("video-safari-restore")).toEqual({
      progress: 826,
      updatedAt: 1000,
    });
    expect(queryClient.getQueryData(["video", "video-safari-restore"])).toEqual(
      expect.objectContaining({
        progress: 826,
      })
    );

    act(() => {
      result.current.setIsDeleting(true);
    });

    dateNowSpy.mockRestore();
  });

  it("releases the resume guard once the player reports a trusted low time", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const video = {
      id: "video-guard-release",
      duration: "1776",
      progress: 826,
      lastPlayedAt: 900,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      writable: true,
      value: 5,
    });
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-guard-release"], video);

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-guard-release", video, videoElement }),
      { wrapper },
    );

    // The player only forwards a time once its saved-progress seek settles, so
    // this simulates the user scrubbing back to 100s before the restore point is
    // reached. That trusted value must release the guard so the real position is
    // persisted instead of the stale 826s resume point.
    videoElement.currentTime = 100;
    act(() => {
      result.current.handleTimeUpdate(100);
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(mockSendVideoProgressWithKeepalive).toHaveBeenCalledWith(
      "video-guard-release",
      100
    );
    expect(mockSendVideoProgressWithKeepalive).not.toHaveBeenCalledWith(
      "video-guard-release",
      826
    );

    act(() => {
      result.current.setIsDeleting(true);
    });

    dateNowSpy.mockRestore();
  });

  it("uses the server resume point when local progress is a stale low Safari sample", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    writeVideoResumeProgress("video-low-local", 5);

    const video = {
      id: "video-low-local",
      duration: "1776",
      progress: 826,
      lastPlayedAt: 900,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      writable: true,
      value: 5,
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-low-local", video, videoElement }),
      { wrapper },
    );

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(mockSendVideoProgressWithKeepalive).toHaveBeenCalledWith(
      "video-low-local",
      826
    );

    act(() => {
      result.current.setIsDeleting(true);
    });

    dateNowSpy.mockRestore();
  });

  it("uses the server resume point when stale local progress is within the guard window", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    writeVideoResumeProgress("video-near-local", 800);
    dateNowSpy.mockReturnValue(80_000);

    const video = {
      id: "video-near-local",
      duration: "1776",
      progress: 826,
      lastPlayedAt: 70_000,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      writable: true,
      value: 800,
    });
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-near-local"], video);

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-near-local", video, videoElement }),
      { wrapper },
    );

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(mockSendVideoProgressWithKeepalive).toHaveBeenCalledWith(
      "video-near-local",
      826
    );
    expect(mockSendVideoProgressWithKeepalive).not.toHaveBeenCalledWith(
      "video-near-local",
      800
    );
    expect(queryClient.getQueryData(["video", "video-near-local"])).toEqual(
      expect.objectContaining({
        progress: 826,
      })
    );

    act(() => {
      result.current.setIsDeleting(true);
    });

    dateNowSpy.mockRestore();
  });

  it("uses a fresher lower server resume point instead of stale local progress", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    writeVideoResumeProgress("video-server-rewind", 120);
    dateNowSpy.mockReturnValue(80_000);

    const video = {
      id: "video-server-rewind",
      duration: "1776",
      progress: 20,
      lastPlayedAt: 70_000,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      writable: true,
      value: 20,
    });
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-server-rewind"], video);

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-server-rewind", video, videoElement }),
      { wrapper },
    );

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(mockSendVideoProgressWithKeepalive).toHaveBeenCalledWith(
      "video-server-rewind",
      20
    );
    expect(mockSendVideoProgressWithKeepalive).not.toHaveBeenCalledWith(
      "video-server-rewind",
      120
    );
    expect(queryClient.getQueryData(["video", "video-server-rewind"])).toEqual(
      expect.objectContaining({
        progress: 20,
      })
    );

    act(() => {
      result.current.setIsDeleting(true);
    });

    dateNowSpy.mockRestore();
  });

  it("does not persist exact duration as the resume progress", () => {
    let now = 1000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const video = {
      id: "video-4",
      duration: "120",
      progress: 0,
      viewCount: 0,
    } as any;
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-4"], video);

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-4", video }),
      { wrapper },
    );

    now = 7000;
    act(() => {
      result.current.handleTimeUpdate(120);
    });

    expect(mockApiPut).toHaveBeenCalledWith("/videos/video-4/progress", {
      progress: 119,
    });
    expect(queryClient.getQueryData(["video", "video-4"])).toEqual(
      expect.objectContaining({
        progress: 119,
      })
    );

    dateNowSpy.mockRestore();
  });

  it("does not clobber saved progress with an immediate save on the first timeupdate", () => {
    let now = 1000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const video = {
      id: "video-5",
      duration: "1776",
      progress: 1222,
      viewCount: 0,
    } as any;
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["videos"], [video]);
    queryClient.setQueryData(["video", "video-5"], video);

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-5", video }),
      { wrapper },
    );

    // Pre-restore tick at ~0, right after mount: the old code saved
    // instantly here (throttle clock started at 0), overwriting the
    // stored resume position with 0.
    act(() => {
      result.current.handleTimeUpdate(0.3);
    });

    expect(mockApiPut).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["video", "video-5"])).toEqual(
      expect.objectContaining({ progress: 1222 })
    );

    // Once real playback has run past the throttle window, saves flow.
    now = 7000;
    act(() => {
      result.current.handleTimeUpdate(1230);
    });

    expect(mockApiPut).toHaveBeenCalledWith("/videos/video-5/progress", {
      progress: 1230,
    });

    dateNowSpy.mockRestore();
  });
});
