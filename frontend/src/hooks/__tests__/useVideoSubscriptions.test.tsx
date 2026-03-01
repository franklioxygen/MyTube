import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoSubscriptions } from "../useVideoSubscriptions";

const mockShowSnackbar = vi.fn();
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

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

vi.mock("../../utils/apiClient", () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
    post: (...args: any[]) => mockApiPost(...args),
    delete: vi.fn(),
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
  const video = {
    id: "v1",
    title: "Video 1",
    author: "Author 1",
    date: "20240201",
    source: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=abc",
    addedAt: "2024-02-01T00:00:00.000Z",
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((url: string) => {
      if (url === "/subscriptions") {
        return Promise.resolve({ data: [] });
      }
      if (url === "/videos/author-channel-url") {
        return Promise.resolve({
          data: {
            success: true,
            channelUrl: "https://www.youtube.com/@author-1",
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    mockApiPost.mockResolvedValue({ data: {} });
  });

  it("should include downloadOrder only when downloadAllPrevious is true", async () => {
    const { result } = renderHook(
      () => useVideoSubscriptions({ video: video as any }),
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

  it("should omit downloadOrder when downloadAllPrevious is false", async () => {
    const { result } = renderHook(
      () => useVideoSubscriptions({ video: video as any }),
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

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    const payload = mockApiPost.mock.calls[0][1];
    expect(payload.downloadAllPrevious).toBe(false);
    expect(payload.downloadShorts).toBe(true);
    expect(payload.downloadOrder).toBeUndefined();
  });
});

