import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatResolution, useVideoResolution } from "../useVideoResolution";

const mockUseCloudStorageUrl = vi.fn();

vi.mock("../useCloudStorageUrl", () => ({
  useCloudStorageUrl: (...args: unknown[]) => mockUseCloudStorageUrl(...args),
}));

const Probe = ({ video }: { video: any }) => {
  const { videoRef, videoResolution, needsDetection } = useVideoResolution(video);

  return (
    <>
      <video data-testid="probe-video" ref={videoRef} />
      <div data-testid="probe-resolution">{videoResolution ?? ""}</div>
      <div data-testid="probe-needs">{String(needsDetection)}</div>
    </>
  );
};

describe("formatResolution", () => {
  it("returns formatted direct resolution value", () => {
    expect(formatResolution({ resolution: "720p" } as any)).toBe("720P");
    expect(formatResolution({ resolution: "4k" } as any)).toBe("4K");
  });

  it("derives resolution from width and height", () => {
    expect(formatResolution({ width: 1920, height: 1080 } as any)).toBe("1080P");
    expect(formatResolution({ width: 3840, height: 2160 } as any)).toBe("4K");
    expect(formatResolution({ width: "640", height: "360" } as any)).toBe("360P");
    expect(formatResolution({ width: 426, height: 240 } as any)).toBe("240P");
    expect(formatResolution({ width: 256, height: 144 } as any)).toBe("144P");
  });

  it("derives resolution from format_id", () => {
    expect(formatResolution({ format_id: "video-144p" } as any)).toBe("144P");
  });

  it("returns null when no resolution information is available", () => {
    expect(formatResolution({} as any)).toBeNull();
  });
});

describe("useVideoResolution", () => {
  const originalRequestIdleCallback = (window as any).requestIdleCallback;
  const originalCancelIdleCallback = (window as any).cancelIdleCallback;
  let loadSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockUseCloudStorageUrl.mockReturnValue(undefined);
    loadSpy = vi
      .spyOn(HTMLMediaElement.prototype, "load")
      .mockImplementation(() => {});
    pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    delete (window as any).requestIdleCallback;
    delete (window as any).cancelIdleCallback;
  });

  afterEach(() => {
    vi.useRealTimers();
    loadSpy.mockRestore();
    pauseSpy.mockRestore();
    if (originalRequestIdleCallback) {
      (window as any).requestIdleCallback = originalRequestIdleCallback;
    } else {
      delete (window as any).requestIdleCallback;
    }
    if (originalCancelIdleCallback) {
      (window as any).cancelIdleCallback = originalCancelIdleCallback;
    } else {
      delete (window as any).cancelIdleCallback;
    }
  });

  it("skips detection when resolution exists on video object", () => {
    render(<Probe video={{ id: "v1", sourceUrl: "https://video", resolution: "1080p" }} />);

    expect(screen.getByTestId("probe-needs")).toHaveTextContent("false");
    expect(screen.getByTestId("probe-resolution")).toHaveTextContent("1080P");
  });

  it("returns null resolution when detection is needed but source is missing", () => {
    render(<Probe video={{ id: "v2" }} />);

    expect(screen.getByTestId("probe-needs")).toHaveTextContent("true");
    expect(screen.getByTestId("probe-resolution")).toHaveTextContent("");
  });

  it("detects resolution with delayed metadata loading fallback", async () => {
    vi.useFakeTimers();
    mockUseCloudStorageUrl.mockReturnValue(undefined);

    render(<Probe video={{ id: "v3", sourceUrl: "https://video.example/file.mp4" }} />);

    const videoElement = screen.getByTestId("probe-video") as HTMLVideoElement;
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    Object.defineProperty(videoElement, "videoHeight", {
      value: 1080,
      configurable: true,
    });
    act(() => {
      videoElement.dispatchEvent(new Event("loadedmetadata"));
    });

    expect(screen.getByTestId("probe-resolution")).toHaveTextContent("1080P");
    expect(videoElement.preload).toBe("none");
    expect(videoElement.src).toContain("https://video.example/file.mp4");
  });

  it("uses requestIdleCallback path and cancels on cleanup", () => {
    const idleMock = vi.fn((cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 10 } as IdleDeadline);
      return 7;
    });
    const cancelIdleMock = vi.fn();
    (window as any).requestIdleCallback = idleMock;
    (window as any).cancelIdleCallback = cancelIdleMock;
    mockUseCloudStorageUrl.mockReturnValue("https://cloud/video.mp4");

    const { unmount } = render(<Probe video={{ id: "v4", sourceUrl: "https://origin/video.mp4" }} />);

    expect(idleMock).toHaveBeenCalled();
    unmount();
    expect(cancelIdleMock).toHaveBeenCalledWith(7);
    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
  });

  it("handles media error events by resetting detected resolution", async () => {
    vi.useFakeTimers();
    render(<Probe video={{ id: "v5", sourceUrl: "https://video.example/file.mp4" }} />);

    const videoElement = screen.getByTestId("probe-video") as HTMLVideoElement;
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    Object.defineProperty(videoElement, "videoHeight", {
      value: 720,
      configurable: true,
    });
    act(() => {
      videoElement.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(screen.getByTestId("probe-resolution")).toHaveTextContent("720P");

    act(() => {
      videoElement.dispatchEvent(new Event("error"));
    });
    expect(screen.getByTestId("probe-resolution")).toHaveTextContent("");
  });

  it.each([
    [480, "480P"],
    [360, "360P"],
    [240, "240P"],
    [144, "144P"],
    [100, ""],
    [0, ""],
  ])(
    "maps metadata height %s to detected resolution '%s'",
    (videoHeight, expectedResolution) => {
      vi.useFakeTimers();
      render(<Probe video={{ id: `height-${videoHeight}`, sourceUrl: "https://video.example/file.mp4" }} />);

      const videoElement = screen.getByTestId("probe-video") as HTMLVideoElement;
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      Object.defineProperty(videoElement, "videoHeight", {
        value: videoHeight,
        configurable: true,
      });
      act(() => {
        videoElement.dispatchEvent(new Event("loadedmetadata"));
      });

      expect(screen.getByTestId("probe-resolution")).toHaveTextContent(expectedResolution);
    }
  );

  it("uses already loaded metadata when readyState indicates metadata is available", () => {
    vi.useFakeTimers();
    render(<Probe video={{ id: "v6", sourceUrl: "https://video.example/ready.mp4" }} />);

    const videoElement = screen.getByTestId("probe-video") as HTMLVideoElement;
    Object.defineProperty(videoElement, "readyState", {
      value: 1,
      configurable: true,
    });
    Object.defineProperty(videoElement, "videoHeight", {
      value: 1440,
      configurable: true,
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId("probe-resolution")).toHaveTextContent("1440P");
  });
});
