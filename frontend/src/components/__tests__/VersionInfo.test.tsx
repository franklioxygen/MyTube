import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VersionInfo from "../VersionInfo";

const mockApiGet = vi.fn();

vi.mock("../../utils/apiClient", () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
  },
}));

describe("VersionInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows update badge when latest version is newer", async () => {
    mockApiGet.mockResolvedValueOnce({
      data: {
        latestVersion: "99.0.0",
        releaseUrl: "https://example.com/releases",
      },
    });

    render(<VersionInfo />);

    await waitFor(() => {
      expect(screen.getByText("Update")).toBeInTheDocument();
    });

    expect(mockApiGet).toHaveBeenCalledWith("/system/version");
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://example.com/releases"
    );
    expect(screen.getByText(/^v\d+\.\d+\.\d+/)).toBeInTheDocument();
  });

  it("does not show update badge when latest version is not newer", async () => {
    mockApiGet.mockResolvedValueOnce({
      data: {
        latestVersion: "0.0.1",
        releaseUrl: "https://example.com/releases",
      },
    });

    render(<VersionInfo />);

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith("/system/version");
    });

    expect(screen.queryByText("Update")).not.toBeInTheDocument();
  });

  it("skips version check when showUpdateBadge is false", () => {
    render(<VersionInfo showUpdateBadge={false} />);

    expect(mockApiGet).not.toHaveBeenCalled();
    expect(screen.queryByText("Update")).not.toBeInTheDocument();
    expect(screen.getByText(/^v\d+\.\d+\.\d+/)).toBeInTheDocument();
  });

  it("fails silently when version check request errors", async () => {
    mockApiGet.mockRejectedValueOnce(new Error("network error"));

    render(<VersionInfo />);

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith("/system/version");
    });

    expect(screen.queryByText("Update")).not.toBeInTheDocument();
    expect(screen.getByText(/^v\d+\.\d+\.\d+/)).toBeInTheDocument();
  });
});
