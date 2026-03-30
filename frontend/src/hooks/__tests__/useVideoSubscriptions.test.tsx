import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoSubscriptions } from "../useVideoSubscriptions";

const mockShowSnackbar = vi.fn();
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();
const mockValidateUrlForOpen = vi.fn();

vi.mock("../../contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../contexts/SnackbarContext", () => ({
  useSnackbar: () => ({
    showSnackbar: mockShowSnackbar,
  }),
}));

vi.mock("../../utils/urlValidation", () => ({
  validateUrlForOpen: (...args: any[]) => mockValidateUrlForOpen(...args),
}));

vi.mock("../../utils/apiClient", () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
    post: (...args: any[]) => mockApiPost(...args),
    delete: (...args: any[]) => mockApiDelete(...args),
  },
  getErrorMessage: (error: any) => {
    if (typeof error?.response?.data?.error === "string") {
      return error.response.data.error;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "unknown";
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useVideoSubscriptions", () => {
  const baseVideo = {
    id: "v1",
    title: "Video 1",
    author: "Author 1",
    date: "20240201",
    source: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=abc",
    addedAt: "2024-02-01T00:00:00.000Z",
  } as const;

  let subscriptionsData: any[];
  let channelUrlData: any;
  let channelUrlError: Error | null;

  beforeEach(() => {
    vi.clearAllMocks();

    subscriptionsData = [];
    channelUrlData = {
      success: true,
      channelUrl: "https://www.youtube.com/@author-1",
    };
    channelUrlError = null;

    mockValidateUrlForOpen.mockImplementation((url: string) => url);
    vi.spyOn(window, "open").mockImplementation(() => null);

    mockApiGet.mockImplementation((url: string) => {
      if (url === "/subscriptions") {
        return Promise.resolve({ data: subscriptionsData });
      }
      if (url === "/videos/author-channel-url") {
        if (channelUrlError) {
          return Promise.reject(channelUrlError);
        }
        return Promise.resolve({ data: channelUrlData });
      }
      return Promise.resolve({ data: {} });
    });

    mockApiPost.mockResolvedValue({ data: {} });
    mockApiDelete.mockResolvedValue({ data: {} });
  });

  it("includes downloadOrder only when downloadAllPrevious is true", async () => {
    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.authorChannelUrl).toBe(
        "https://www.youtube.com/@author-1"
      );
    });

    await act(async () => {
      await result.current.handleSubscribeConfirm(60, true, false, "viewsDesc");
    });

    expect(mockApiPost).toHaveBeenCalledWith(
      "/subscriptions",
      expect.objectContaining({
        url: "https://www.youtube.com/@author-1",
        interval: 60,
        authorName: "Author 1",
        downloadAllPrevious: true,
        downloadShorts: false,
        downloadOrder: "viewsDesc",
      })
    );
  });

  it("omits downloadOrder when downloadAllPrevious is false", async () => {
    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.authorChannelUrl).toBe(
        "https://www.youtube.com/@author-1"
      );
    });

    await act(async () => {
      await result.current.handleSubscribeConfirm(30, false, true, "viewsAsc");
    });

    const payload = mockApiPost.mock.calls[0][1];
    expect(payload.downloadAllPrevious).toBe(false);
    expect(payload.downloadShorts).toBe(true);
    expect(payload.downloadOrder).toBeUndefined();
  });

  it("does not request author channel URL for unsupported sources", async () => {
    const unsupportedVideo = {
      ...baseVideo,
      source: "xiaohongshu",
      sourceUrl: "https://www.xiaohongshu.com/explore/123",
    };

    const { result } = renderHook(
      () => useVideoSubscriptions({ video: unsupportedVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith("/subscriptions");
    });

    expect(result.current.authorChannelUrl).toBeNull();
    const requestedChannelUrl = mockApiGet.mock.calls.some(
      (call) => call[0] === "/videos/author-channel-url"
    );
    expect(requestedChannelUrl).toBe(false);
  });

  it("requests author channel URL for twitch videos", async () => {
    const twitchVideo = {
      ...baseVideo,
      source: "twitch",
      sourceUrl: "https://www.twitch.tv/videos/12345",
    };
    channelUrlData = {
      success: true,
      channelUrl: "https://www.twitch.tv/author_1",
    };

    const { result } = renderHook(
      () => useVideoSubscriptions({ video: twitchVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.authorChannelUrl).toBe(
        "https://www.twitch.tv/author_1"
      );
    });

    expect(mockApiGet).toHaveBeenCalledWith("/videos/author-channel-url", {
      params: { sourceUrl: "https://www.twitch.tv/videos/12345" },
    });
  });

  it("marks video subscribed by strict author URL match", async () => {
    subscriptionsData = [
      {
        id: "sub-url",
        author: "Other Author",
        platform: "youtube",
        authorUrl: "https://www.youtube.com/@author-1",
      },
    ];

    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.subscriptionId).toBe("sub-url");
    });

    expect(result.current.isSubscribed).toBe(true);
  });

  it("falls back to author/platform matching when channel URL is unavailable", async () => {
    subscriptionsData = [
      {
        id: "sub-fallback",
        author: "Author 1",
        platform: "YouTube",
      },
    ];
    channelUrlData = { success: false, channelUrl: null };

    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.subscriptionId).toBe("sub-fallback");
    });

    expect(result.current.isSubscribed).toBe(true);
  });

  it("opens external channel URL when handleAuthorClick has a validated URL", async () => {
    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.authorChannelUrl).toBe(
        "https://www.youtube.com/@author-1"
      );
    });

    let clickResult: any;
    act(() => {
      clickResult = result.current.handleAuthorClick();
    });

    expect(clickResult).toBeNull();
    expect(mockValidateUrlForOpen).toHaveBeenCalledWith(
      "https://www.youtube.com/@author-1"
    );
    expect(window.open).toHaveBeenCalledWith(
      "https://www.youtube.com/@author-1",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("returns internal author navigation path when URL is not valid for open", async () => {
    mockValidateUrlForOpen.mockReturnValue(null);

    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.authorChannelUrl).toBe(
        "https://www.youtube.com/@author-1"
      );
    });

    const clickResult = result.current.handleAuthorClick();
    expect(clickResult).toEqual({
      shouldNavigate: true,
      path: "/author/Author%201",
    });
    expect(window.open).not.toHaveBeenCalled();
  });

  it("returns null from handleAuthorClick when video is missing", () => {
    const { result } = renderHook(() => useVideoSubscriptions({ video: undefined }), {
      wrapper: createWrapper(),
    });

    expect(result.current.handleAuthorClick()).toBeNull();
  });

  it("opens subscribe modal only when authorChannelUrl exists", async () => {
    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.authorChannelUrl).toBeTruthy();
    });

    expect(result.current.showSubscribeModal).toBe(false);
    act(() => {
      result.current.handleSubscribe();
    });
    expect(result.current.showSubscribeModal).toBe(true);

    channelUrlData = { success: false, channelUrl: null };
    const { result: resultNoChannel } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(resultNoChannel.current.authorChannelUrl).toBeNull();
    });

    act(() => {
      resultNoChannel.current.handleSubscribe();
    });
    expect(resultNoChannel.current.showSubscribeModal).toBe(false);
  });

  it("shows warning snackbar on 409 subscribe conflicts", async () => {
    mockApiPost.mockRejectedValueOnce({ response: { status: 409 } });

    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.authorChannelUrl).toBeTruthy();
    });

    await act(async () => {
      await result.current.handleSubscribeConfirm(30, false, false, "viewsDesc");
    });

    expect(mockShowSnackbar).toHaveBeenCalledWith(
      "subscriptionAlreadyExists",
      "warning"
    );
    expect(result.current.showSubscribeModal).toBe(false);
  });

  it("shows generic error snackbar when subscribe fails unexpectedly", async () => {
    mockApiPost.mockRejectedValueOnce(new Error("network"));

    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.authorChannelUrl).toBeTruthy();
    });

    await act(async () => {
      await result.current.handleSubscribeConfirm(30, true, false, "viewsDesc");
    });

    expect(mockShowSnackbar).toHaveBeenCalledWith("error", "error");
    expect(result.current.showSubscribeModal).toBe(false);
  });

  it("shows backend validation message for twitch subscription failures", async () => {
    const twitchVideo = {
      ...baseVideo,
      source: "twitch",
      sourceUrl: "https://www.twitch.tv/videos/12345",
    };
    channelUrlData = {
      success: true,
      channelUrl: "https://www.twitch.tv/author_1",
    };
    mockApiPost.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          error: "Twitch credentials are missing",
        },
      },
    });

    const { result } = renderHook(
      () => useVideoSubscriptions({ video: twitchVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.authorChannelUrl).toBeTruthy();
    });

    await act(async () => {
      await result.current.handleSubscribeConfirm(30, false, false, "dateDesc");
    });

    expect(mockShowSnackbar).toHaveBeenCalledWith(
      "Twitch credentials are missing",
      "error"
    );
  });

  it("does not submit subscription when required values are missing", async () => {
    const { result } = renderHook(() => useVideoSubscriptions({ video: undefined }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.handleSubscribeConfirm(30, true, true, "viewsAsc");
    });

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("calls unsubscribe confirm callback only when a subscription exists", async () => {
    subscriptionsData = [
      {
        id: "sub-confirm",
        author: "Author 1",
        platform: "youtube",
        authorUrl: "https://www.youtube.com/@author-1",
      },
    ];

    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.subscriptionId).toBe("sub-confirm");
    });

    const onConfirm = vi.fn();
    act(() => {
      result.current.handleUnsubscribe(onConfirm);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    subscriptionsData = [];
    const { result: noSubscriptionResult } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(noSubscriptionResult.current.subscriptionId).toBeNull();
    });

    const onConfirmNoop = vi.fn();
    act(() => {
      noSubscriptionResult.current.handleUnsubscribe(onConfirmNoop);
    });
    expect(onConfirmNoop).not.toHaveBeenCalled();
  });

  it("handles unsubscribe mutation success and failure paths", async () => {
    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith("/subscriptions");
    });

    await act(async () => {
      await result.current.unsubscribeMutation.mutateAsync("sub-ok");
    });

    expect(mockApiDelete).toHaveBeenCalledWith("/subscriptions/sub-ok");
    expect(mockShowSnackbar).toHaveBeenCalledWith("unsubscribedSuccessfully");

    mockApiDelete.mockRejectedValueOnce(new Error("delete failed"));

    await act(async () => {
      await expect(
        result.current.unsubscribeMutation.mutateAsync("sub-fail")
      ).rejects.toThrow("delete failed");
    });

    expect(mockShowSnackbar).toHaveBeenCalledWith("error", "error");
  });

  it("resets authorChannelUrl to null when author-channel-url API fails", async () => {
    channelUrlError = new Error("failed to fetch channel");

    const { result } = renderHook(
      () => useVideoSubscriptions({ video: baseVideo as any }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.authorChannelUrl).toBeNull();
    });

    expect(mockApiGet).toHaveBeenCalledWith("/videos/author-channel-url", {
      params: { sourceUrl: "https://www.youtube.com/watch?v=abc" },
    });
  });
});
