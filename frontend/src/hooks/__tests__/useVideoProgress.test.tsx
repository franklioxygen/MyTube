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

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useVideoProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRole = "admin";
    mockApiPost.mockResolvedValue({ data: { success: true, viewCount: 1 } });
    mockApiPut.mockResolvedValue({ data: { success: true } });
  });

  it("counts view after 4 seconds for short MM:SS duration", async () => {
    const video = { duration: "0:15" } as any;
    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-1", video }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleTimeUpdate(3);
    });
    expect(mockApiPost).not.toHaveBeenCalled();

    act(() => {
      result.current.handleTimeUpdate(5);
    });

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/videos/video-1/view");
    });

    act(() => {
      result.current.setIsDeleting(true);
    });
  });

  it("keeps 10-second threshold for non-short videos", async () => {
    const video = { duration: "120" } as any;
    const { result } = renderHook(
      () => useVideoProgress({ videoId: "video-2", video }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleTimeUpdate(5);
    });
    expect(mockApiPost).not.toHaveBeenCalled();

    act(() => {
      result.current.handleTimeUpdate(11);
    });

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/videos/video-2/view");
    });

    act(() => {
      result.current.setIsDeleting(true);
    });
  });
});
