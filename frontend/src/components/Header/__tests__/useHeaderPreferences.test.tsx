import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHeaderPreferences } from "../useHeaderPreferences";

const mockApiGet = vi.fn();

vi.mock("../../../utils/apiClient", () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
  },
}));

describe("useHeaderPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({
      data: {
        websiteName: " Public Name ",
        infiniteScroll: true,
        showThemeButton: false,
      },
    });
  });

  it("fetches and applies public header settings for unauthenticated users", async () => {
    const { result } = renderHook(() => useHeaderPreferences(false));

    await waitFor(() => {
      expect(result.current.websiteName).toBe("Public Name");
    });

    expect(result.current.infiniteScroll).toBe(true);
    expect(result.current.showThemeButton).toBe(false);
    expect(mockApiGet).toHaveBeenCalledWith("/settings");
  });

  it("keeps defaults when unauthenticated settings payload is empty", async () => {
    mockApiGet.mockResolvedValueOnce({ data: null });

    const { result } = renderHook(() => useHeaderPreferences(false));

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith("/settings");
    });

    expect(result.current.websiteName).toBe("MyTube");
    expect(result.current.infiniteScroll).toBe(false);
    expect(result.current.showThemeButton).toBe(true);
  });

  it("keeps defaults when unauthenticated fetch throws", async () => {
    mockApiGet.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useHeaderPreferences(false));

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith("/settings");
    });

    expect(result.current.websiteName).toBe("MyTube");
    expect(result.current.infiniteScroll).toBe(false);
    expect(result.current.showThemeButton).toBe(true);
  });

  it("uses authenticated settingsData and skips public fetch", () => {
    const { result } = renderHook(() =>
      useHeaderPreferences(true, {
        websiteName: "  Admin Site  ",
        infiniteScroll: true,
        showThemeButton: false,
      })
    );

    expect(result.current.websiteName).toBe("Admin Site");
    expect(result.current.infiniteScroll).toBe(true);
    expect(result.current.showThemeButton).toBe(false);
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it("falls back to authenticated defaults when settingsData is missing", () => {
    const { result } = renderHook(() => useHeaderPreferences(true));

    expect(result.current.websiteName).toBe("MyTube");
    expect(result.current.infiniteScroll).toBe(false);
    expect(result.current.showThemeButton).toBe(true);
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});
