import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoProgress } from "../useVideoProgress";

const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
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
    mockUserRole = "admin";
    mockApiPost.mockResolvedValue({ data: { success: true, viewCount: 1 } });
    mockApiPut.mockResolvedValue({ data: { success: true } });
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
  });

  it("counts view at 4 seconds for short MM:SS duration without syncing progress cache", async () => {
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
          viewCount: 1,
          lastPlayedAt: 7000,
        }),
      ]);
      expect(queryClient.getQueryData(["video", "video-1"])).toEqual(
        expect.objectContaining({
          id: "video-1",
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

  it("keeps progress writes out of the cache until the view threshold is reached", async () => {
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
      expect(queryClient.getQueryData(["videos"])).toEqual([video]);
      expect(queryClient.getQueryData(["video", "video-2"])).toEqual(video);
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
          viewCount: 1,
          lastPlayedAt: expect.any(Number),
        }),
      ]);
      expect(queryClient.getQueryData(["video", "video-2"])).toEqual(
        expect.objectContaining({
          id: "video-2",
          viewCount: 1,
          lastPlayedAt: expect.any(Number),
        })
      );
    });

    act(() => {
      result.current.setIsDeleting(true);
    });
  });

  it("sends progress on unmount without mutating the cache", () => {
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

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/videos/video-3/progress",
      expect.objectContaining({
        method: "PUT",
        keepalive: true,
        credentials: "include",
        body: JSON.stringify({ progress: 3 }),
      })
    );
    expect(queryClient.getQueryData(["videos"])).toEqual([video]);
    expect(queryClient.getQueryData(["video", "video-3"])).toEqual(video);
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
});
