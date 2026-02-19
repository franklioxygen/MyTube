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
    result.current.videoRef.current = videoElement;

    // Initialize duration state and set initial position
    act(() => {
      // @ts-expect-error Mock event missing properties
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

    result.current.videoRef.current = videoElement;

    // Initialize duration state
    act(() => {
      // @ts-expect-error Mock event missing properties
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

    result.current.videoRef.current = videoElement;

    // Initialize duration state
    act(() => {
      // @ts-expect-error Mock event missing properties
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

    result.current.videoRef.current = videoElement;

    act(() => {
      // @ts-expect-error Mock event missing properties
      result.current.handleLoadedMetadata({ currentTarget: videoElement });
    });

    // startTime should be applied
    expect(videoElement.currentTime).toBe(30);
  });

  it("should apply startTime only once via handleCanPlay", () => {
    const { result } = renderHook(() =>
      useVideoPlayer({ src: "test.mp4", startTime: 30 })
    );

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

    result.current.videoRef.current = videoElement;

    // Initial load - startTime applied
    act(() => {
      // @ts-expect-error Mock event missing properties
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

  it("should apply startTime when it changes after initial load (async fetch)", () => {
    // Start with startTime 0
    const { result, rerender } = renderHook(
      (props) => useVideoPlayer(props),
      {
        initialProps: { src: "test.mp4", startTime: 0 }
      }
    );

    result.current.videoRef.current = videoElement;

    // Initial load with startTime 0
    act(() => {
      // @ts-expect-error Mock event missing properties
      result.current.handleCanPlay();
    });

    expect(videoElement.currentTime).toBe(0);

    // Simulate fetch completing and updating startTime to 45
    rerender({ src: "test.mp4", startTime: 45 });

    // Should update to new startTime using fastSeek
    expect(videoElement.fastSeek).toHaveBeenCalledWith(45);
  });
});

describe("useVideoPlayer playbackRate behavior", () => {
  let videoElement: HTMLVideoElement;

  beforeEach(() => {
    videoElement = document.createElement("video");
    Object.defineProperty(videoElement, "playbackRate", {
      writable: true,
      value: 1,
    });
  });

  it("should have an initial playbackRate of 1", () => {
    const { result } = renderHook(() => useVideoPlayer({ src: "test.mp4" }));
    expect(result.current.playbackRate).toBe(1);
  });

  it("should update playbackRate state when handlePlaybackRateChange is called", () => {
    const { result } = renderHook(() => useVideoPlayer({ src: "test.mp4" }));
    result.current.videoRef.current = videoElement;

    act(() => {
      result.current.handlePlaybackRateChange(1.5);
    });

    expect(result.current.playbackRate).toBe(1.5);
  });

  it("should set videoElement.playbackRate when handlePlaybackRateChange is called", () => {
    const { result } = renderHook(() => useVideoPlayer({ src: "test.mp4" }));
    result.current.videoRef.current = videoElement;

    act(() => {
      result.current.handlePlaybackRateChange(2);
    });

    expect(videoElement.playbackRate).toBe(2);
  });

  it("should update state even when no video element is attached", () => {
    const { result } = renderHook(() => useVideoPlayer({ src: "test.mp4" }));
    // videoRef.current remains null

    act(() => {
      result.current.handlePlaybackRateChange(0.5);
    });

    expect(result.current.playbackRate).toBe(0.5);
  });

  it("should reflect the latest rate after multiple changes", () => {
    const { result } = renderHook(() => useVideoPlayer({ src: "test.mp4" }));
    result.current.videoRef.current = videoElement;

    act(() => { result.current.handlePlaybackRateChange(0.75); });
    act(() => { result.current.handlePlaybackRateChange(2); });

    expect(result.current.playbackRate).toBe(2);
    expect(videoElement.playbackRate).toBe(2);
  });
});
