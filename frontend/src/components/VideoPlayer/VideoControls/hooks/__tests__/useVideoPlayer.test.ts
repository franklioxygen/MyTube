import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoPlayer } from "../useVideoPlayer";

describe("useVideoPlayer seek behavior", () => {
  let videoElement: HTMLVideoElement;

  beforeEach(() => {
    // Mock the video element attached to the ref
    videoElement = document.createElement("video");

    // Mock fastSeek method
    videoElement.fastSeek = vi.fn();

    // Mock other properties
    Object.defineProperty(videoElement, "duration", {
      writable: true,
      value: 100,
    });
    Object.defineProperty(videoElement, "currentTime", {
      writable: true,
      value: 0,
    });
  });

  it("should use fastSeek when seeking to a non-zero time if available", () => {
    const { result } = renderHook(() => useVideoPlayer({ src: "test.mp4" }));

    // Manually set the current ref value since renderHook won't attach it to our mock
    // @ts-ignore
    result.current.videoRef.current = videoElement;

    // Initialize duration state and set initial position
    act(() => {
      // @ts-ignore
      result.current.handleLoadedMetadata({ currentTarget: videoElement });
    });

    // Set currentTime to 50 for the seek test
    videoElement.currentTime = 50;

    // Simulate seeking to 10 seconds
    act(() => {
      // Seek via handleSeek (button jump)
      result.current.handleSeek(-40); // 50 - 40 = 10
    });

    expect(videoElement.fastSeek).toHaveBeenCalledWith(10);
  });

  it("should allow seeking to 0 via handleSeek", () => {
    const { result } = renderHook(() => useVideoPlayer({ src: "test.mp4" }));

    // @ts-ignore
    result.current.videoRef.current = videoElement;

    // Initialize duration state
    act(() => {
      // @ts-ignore
      result.current.handleLoadedMetadata({ currentTarget: videoElement });
    });

    // Set currentTime to 50 for the seek test
    videoElement.currentTime = 50;

    // Simulate seeking to 0 seconds (e.g. from 50s, jump back 60s)
    act(() => {
      result.current.handleSeek(-60); // max(0, 50 - 60) = 0
    });

    // fastSeek should be called with 0
    expect(videoElement.fastSeek).toHaveBeenCalledWith(0);
  });

  it("should allow seeking to 0 via slider", () => {
    const { result } = renderHook(() => useVideoPlayer({ src: "test.mp4" }));

    // @ts-ignore
    result.current.videoRef.current = videoElement;

    // Initialize duration state
    act(() => {
      // @ts-ignore
      result.current.handleLoadedMetadata({ currentTarget: videoElement });
    });

    // Set currentTime to 50 for the seek test
    videoElement.currentTime = 50;

    // Simulate dragging slider to 0%
    act(() => {
      result.current.handleProgressChangeCommitted(0);
    });

    // fastSeek should be called with 0
    expect(videoElement.fastSeek).toHaveBeenCalledWith(0);
  });
});

describe("useVideoPlayer startTime behavior", () => {
  let videoElement: HTMLVideoElement;

  beforeEach(() => {
    videoElement = document.createElement("video");
    videoElement.fastSeek = vi.fn();

    Object.defineProperty(videoElement, "duration", {
      writable: true,
      value: 100,
    });
    Object.defineProperty(videoElement, "currentTime", {
      writable: true,
      value: 0,
    });
  });

  it("should apply startTime on initial load via handleLoadedMetadata", () => {
    const { result } = renderHook(() =>
      useVideoPlayer({ src: "test.mp4", startTime: 30 })
    );

    // @ts-ignore
    result.current.videoRef.current = videoElement;

    act(() => {
      // @ts-ignore
      result.current.handleLoadedMetadata({ currentTarget: videoElement });
    });

    // startTime should be applied
    expect(videoElement.currentTime).toBe(30);
  });

  it("should apply startTime only once via handleCanPlay", () => {
    const { result } = renderHook(() =>
      useVideoPlayer({ src: "test.mp4", startTime: 30 })
    );

    // @ts-ignore
    result.current.videoRef.current = videoElement;

    // First handleCanPlay should apply startTime
    act(() => {
      result.current.handleCanPlay();
    });

    expect(videoElement.currentTime).toBe(30);

    // Reset currentTime to 0 (simulating user seek to 0)
    videoElement.currentTime = 0;

    // Second handleCanPlay should NOT reset to startTime
    act(() => {
      result.current.handleCanPlay();
    });

    // currentTime should remain at 0, not reset to 30
    expect(videoElement.currentTime).toBe(0);
  });

  it("should not reset to startTime after user seeks to 0", () => {
    const { result } = renderHook(() =>
      useVideoPlayer({ src: "test.mp4", startTime: 30 })
    );

    // @ts-ignore
    result.current.videoRef.current = videoElement;

    // Initial load - startTime applied
    act(() => {
      // @ts-ignore
      result.current.handleLoadedMetadata({ currentTarget: videoElement });
    });

    expect(videoElement.currentTime).toBe(30);

    // User seeks to 0
    act(() => {
      result.current.handleProgressChangeCommitted(0);
    });

    // Simulate canplay event after seek
    videoElement.currentTime = 0;
    act(() => {
      result.current.handleCanPlay();
    });

    // Should stay at 0, not reset to startTime
    expect(videoElement.currentTime).toBe(0);
  });
});
