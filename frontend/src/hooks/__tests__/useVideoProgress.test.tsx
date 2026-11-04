import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// Feed one tick per played second: a single large step looks like a seek.
const playThrough = (
  result: { current: ReturnType<typeof useVideoProgress> },
  from: number,
  to: number,
) => {
  for (let time = from; time <= to; time += 1) {
    act(() => {
      result.current.handleTimeUpdate(time);
    });
  }
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

    playThrough(result, 1, 4);

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

    playThrough(result, 6, 10);

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

  it("counts a repeat visit after an intermediate video leaves before the view threshold", async () => {
    const videoA = {
      id: "video-repeat-a",
      duration: "120",
      progress: 0,
      viewCount: 0,
    } as any;
    const videoB = {
      id: "video-repeat-b",
      duration: "120",
      progress: 0,
      viewCount: 0,
    } as any;
    const { wrapper } = createWrapper();

    const { result, rerender } = renderHook(
      ({ video }) => useVideoProgress({ videoId: video.id, video }),
      {
        wrapper,
        initialProps: { video: videoA },
      },
    );

    playThrough(result, 1, 10);
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/videos/video-repeat-a/view");
    });

    rerender({ video: videoB });
    act(() => {
      result.current.handleTimeUpdate(2);
    });
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    // The return visit resumes at 10s, so landing there must not count again.
    rerender({ video: videoA });
    act(() => {
      result.current.handleTimeUpdate(10);
    });
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    playThrough(result, 11, 20);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledTimes(2);
    });
    expect(mockApiPost).toHaveBeenLastCalledWith("/videos/video-repeat-a/view");
  });

  it("does not carry played time from an earlier visit into the next one", () => {
    const videoA = {
      id: "video-carry-a",
      duration: "120",
      progress: 0,
      viewCount: 0,
    } as any;
    const videoB = {
      id: "video-carry-b",
      duration: "120",
      progress: 0,
      viewCount: 0,
    } as any;
    const { wrapper } = createWrapper();

    const { result, rerender } = renderHook(
      ({ video }) => useVideoProgress({ videoId: video.id, video }),
      {
        wrapper,
        initialProps: { video: videoA },
      },
    );

    playThrough(result, 1, 9);
    rerender({ video: videoB });
    rerender({ video: videoA });

    playThrough(result, 10, 18);
    expect(mockApiPost).not.toHaveBeenCalled();

    playThrough(result, 19, 19);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["long", "1776", 826],
    ["short", "0:18", 15],
  ])(
    "does not count a %s video restored past the threshold without playback",
    async (_label, duration, progress) => {
      const video = {
        id: "video-restored-paused",
        duration,
        progress,
        lastPlayedAt: 900,
        viewCount: 5,
      } as any;
      const { queryClient, wrapper } = createWrapper();
      queryClient.setQueryData(["video", "video-restored-paused"], video);

      const { result } = renderHook(
        () => useVideoProgress({ videoId: "video-restored-paused", video }),
        { wrapper },
      );

      // The player reports the restored position once its seek settles, and the
      // browser's own timeupdate can repeat it while the video stays paused.
      act(() => {
        result.current.handleTimeUpdate(progress);
      });
      act(() => {
        result.current.handleTimeUpdate(progress);
      });

      expect(mockApiPost).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(["video", "video-restored-paused"])).toEqual(
        expect.objectContaining({ lastPlayedAt: 900, viewCount: 5 })
      );
    }
  );

  it("does not count a restore that local progress reports ahead of the server", () => {
    writeVideoResumeProgress("video-restored-local", 300);
    const video = {
      id: "video-restored-local",
      duration: "1776",
      progress: 0,
      viewCount: 5,
    } as any;
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-restored-local", video }),
      { wrapper },
    );

    act(() => {
      result.current.handleTimeUpdate(300);
    });

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("does not credit a small restored position as played time", () => {
    const video = {
      id: "video-restored-small",
      duration: "0:15",
      progress: 3,
      viewCount: 0,
    } as any;
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-restored-small", video }),
      { wrapper },
    );

    // 3s is within the playback step limit, so only the baseline keeps it out.
    playThrough(result, 3, 6);
    expect(mockApiPost).not.toHaveBeenCalled();

    playThrough(result, 7, 7);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it("counts one view after playing the threshold from a restored position", async () => {
    let now = 1000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const video = {
      id: "video-restored-played",
      duration: "1776",
      progress: 826,
      lastPlayedAt: 900,
      viewCount: 5,
    } as any;
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["video", "video-restored-played"], video);

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-restored-played", video }),
      { wrapper },
    );

    playThrough(result, 826, 835);
    expect(mockApiPost).not.toHaveBeenCalled();

    now = 2000;
    playThrough(result, 836, 836);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith("/videos/video-restored-played/view");

    await waitFor(() => {
      expect(queryClient.getQueryData(["video", "video-restored-played"])).toEqual(
        expect.objectContaining({ lastPlayedAt: 2000, viewCount: 1 })
      );
    });

    playThrough(result, 837, 860);
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    dateNowSpy.mockRestore();
  });

  it("does not treat large seeks as playback", () => {
    const video = {
      id: "video-large-seek",
      duration: "1776",
      progress: 0,
      viewCount: 0,
    } as any;
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-large-seek", video }),
      { wrapper },
    );

    playThrough(result, 1, 2);

    // Dragged forward, then back: neither direction adds played time.
    act(() => {
      result.current.handleTimeUpdate(300);
    });
    act(() => {
      result.current.handleTimeUpdate(50);
    });
    expect(mockApiPost).not.toHaveBeenCalled();

    playThrough(result, 51, 57);
    expect(mockApiPost).not.toHaveBeenCalled();

    playThrough(result, 58, 58);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it("does not let a single jump reach the short video threshold", () => {
    const video = {
      id: "video-short-jump",
      duration: "0:15",
      progress: 0,
      viewCount: 0,
    } as any;
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-short-jump", video }),
      { wrapper },
    );

    act(() => {
      result.current.handleTimeUpdate(4);
    });

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("does not count small seeks reported by the media element", () => {
    const video = {
      id: "video-small-seek",
      duration: "0:15",
      progress: 0,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      writable: true,
      value: 0,
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-small-seek", video, videoElement }),
      { wrapper },
    );

    const seekTo = (time: number) => {
      videoElement.currentTime = time;
      act(() => {
        videoElement.dispatchEvent(new Event("seeking"));
        result.current.handleTimeUpdate(time);
      });
    };

    playThrough(result, 1, 1);
    seekTo(3);
    seekTo(5);
    seekTo(7);
    expect(mockApiPost).not.toHaveBeenCalled();

    playThrough(result, 8, 9);
    expect(mockApiPost).not.toHaveBeenCalled();

    playThrough(result, 10, 10);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it("does not count a sample taken before the seeking event is delivered", () => {
    const video = {
      id: "video-seek-gap",
      duration: "0:15",
      progress: 0,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(videoElement, "seeking", {
      configurable: true,
      writable: true,
      value: false,
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-seek-gap", video, videoElement }),
      { wrapper },
    );

    // Writing currentTime flips `seeking` at once, but the event is queued, so
    // a sample can read the new position before the event arrives.
    const seekTo = (time: number) => {
      videoElement.currentTime = time;
      (videoElement as any).seeking = true;
      act(() => {
        videoElement.dispatchEvent(new Event("playing"));
        videoElement.dispatchEvent(new Event("seeking"));
      });
      (videoElement as any).seeking = false;
      act(() => {
        result.current.handleTimeUpdate(time);
      });
    };

    playThrough(result, 1, 1);
    seekTo(3);
    seekTo(5);
    seekTo(7);

    playThrough(result, 8, 9);
    expect(mockApiPost).not.toHaveBeenCalled();

    playThrough(result, 10, 10);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it("does not count a seek that keeps reporting the old position until it ends", () => {
    const video = {
      id: "video-slow-seek",
      duration: "0:15",
      progress: 0,
      viewCount: 0,
    } as any;
    const videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      writable: true,
      value: 1,
    });
    Object.defineProperty(videoElement, "seeking", {
      configurable: true,
      writable: true,
      value: false,
    });
    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-slow-seek", video, videoElement }),
      { wrapper: createWrapper().wrapper },
    );

    const slowSeekTo = (time: number) => {
      (videoElement as any).seeking = true;
      act(() => {
        videoElement.dispatchEvent(new Event("seeking"));
        // A sample lands mid-seek and still reads the old position.
        videoElement.dispatchEvent(new Event("playing"));
      });
      videoElement.currentTime = time;
      (videoElement as any).seeking = false;
      act(() => {
        videoElement.dispatchEvent(new Event("seeked"));
      });
    };

    playThrough(result, 1, 1);
    slowSeekTo(3);
    slowSeekTo(5);
    slowSeekTo(7);

    playThrough(result, 8, 9);
    expect(mockApiPost).not.toHaveBeenCalled();

    playThrough(result, 10, 10);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it("does not count seeks the player flags as seeked", () => {
    const video = {
      id: "video-flagged-seek",
      duration: "1776",
      progress: 0,
      viewCount: 0,
    } as any;
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-flagged-seek", video }),
      { wrapper },
    );

    // The compatibility player has no media element, so this flag is all it has.
    for (let time = 2; time <= 12; time += 2) {
      act(() => {
        result.current.handleTimeUpdate(time, { seeked: true });
      });
    }
    expect(mockApiPost).not.toHaveBeenCalled();

    playThrough(result, 13, 21);
    expect(mockApiPost).not.toHaveBeenCalled();

    playThrough(result, 22, 22);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  describe("while timeupdate is deferred", () => {
    const renderWithElement = (id: string) => {
      const video = { id, duration: "1776", progress: 0, viewCount: 0 } as any;
      const videoElement = document.createElement("video");
      Object.defineProperty(videoElement, "currentTime", {
        configurable: true,
        writable: true,
        value: 0,
      });
      const { wrapper } = createWrapper();
      const view = renderHook(
        () => useVideoProgress({ videoId: id, video, videoElement }),
        { wrapper },
      );
      // 3x speed sampled once a second, with no timeupdate delivered meanwhile.
      const sampleAt = (time: number, lateByMs = 0) => {
        videoElement.currentTime = time;
        vi.setSystemTime(Date.now() + lateByMs);
        act(() => {
          vi.advanceTimersByTime(1000);
        });
      };
      return { ...view, sampleAt, videoElement };
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("counts one view when samples cross the threshold", () => {
      const { result, sampleAt } = renderWithElement("video-deferred-ticks");

      sampleAt(3);
      sampleAt(6);
      sampleAt(9);
      expect(mockApiPost).not.toHaveBeenCalled();

      sampleAt(12);
      expect(mockApiPost).toHaveBeenCalledTimes(1);
      expect(mockApiPost).toHaveBeenCalledWith("/videos/video-deferred-ticks/view");

      // The deferred tick finally arrives and must not count the visit again.
      act(() => {
        result.current.handleTimeUpdate(12);
      });
      sampleAt(15);
      expect(mockApiPost).toHaveBeenCalledTimes(1);
    });

    it("counts samples that run late at the fastest speed", () => {
      const { sampleAt } = renderWithElement("video-deferred-late");

      // Half a second late at 3x covers 4.5s, past the on-time step limit.
      sampleAt(4.5, 500);
      sampleAt(9, 500);
      expect(mockApiPost).not.toHaveBeenCalled();

      sampleAt(13.5, 500);
      expect(mockApiPost).toHaveBeenCalledTimes(1);
    });

    it("still treats a jump beyond the time since the last sample as a seek", () => {
      const { sampleAt } = renderWithElement("video-deferred-jump");

      sampleAt(3);
      sampleAt(6);
      sampleAt(9);

      // On time, then half a second late: neither could have played this far.
      sampleAt(15);
      sampleAt(45, 500);
      expect(mockApiPost).not.toHaveBeenCalled();

      sampleAt(46);
      expect(mockApiPost).toHaveBeenCalledTimes(1);
    });

    it("counts the view when leaving crosses the threshold", () => {
      const { sampleAt, unmount, videoElement } = renderWithElement("video-deferred-leave");

      sampleAt(3);
      sampleAt(6);
      sampleAt(9);
      expect(mockApiPost).not.toHaveBeenCalled();

      videoElement.currentTime = 10.5;
      act(() => {
        unmount();
      });

      expect(mockApiPost).toHaveBeenCalledTimes(1);
      expect(mockApiPost).toHaveBeenCalledWith("/videos/video-deferred-leave/view");
    });

    it("does not count a view for a video being deleted", () => {
      const { result, sampleAt } = renderWithElement("video-deferred-deleting");

      sampleAt(3);
      act(() => {
        result.current.setIsDeleting(true);
      });
      sampleAt(6);
      sampleAt(9);
      sampleAt(12);

      expect(mockApiPost).not.toHaveBeenCalled();
    });
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
      lastPlayedAt: 500,
      progressUpdatedAt: 70_000,
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
