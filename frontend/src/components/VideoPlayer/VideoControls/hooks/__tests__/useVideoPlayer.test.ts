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
      value: 50,
    });
  });

  it("should use fastSeek when seeking to a non-zero time if available", () => {
    const { result } = renderHook(() =>
      useVideoPlayer({ src: "test.mp4" })
    );

    // Manually set the current ref value since renderHook won't attach it to our mock
    // @ts-ignore
    result.current.videoRef.current = videoElement;

    // Initialize duration state
    act(() => {
      // @ts-ignore
      result.current.handleLoadedMetadata({ currentTarget: videoElement });
    });

    // Simulate seeking to 10 seconds
    act(() => {
      // Seek via handleSeek (button jump)
      result.current.handleSeek(-40); // 50 - 40 = 10
    });

    expect(videoElement.fastSeek).toHaveBeenCalledWith(10);
    expect(videoElement.currentTime).toBe(50); // Should not set currentTime directly
  });

  it("should bypass fastSeek and set currentTime directly when seeking to 0", () => {
    const { result } = renderHook(() =>
      useVideoPlayer({ src: "test.mp4" })
    );

    // @ts-ignore
    result.current.videoRef.current = videoElement;

    // Initialize duration state
    act(() => {
      // @ts-ignore
      result.current.handleLoadedMetadata({ currentTarget: videoElement });
    });

    // Simulate seeking to 0 seconds (e.g. from 50s, jump back 60s)
    act(() => {
      result.current.handleSeek(-60); // max(0, 50 - 60) = 0
    });

    // CRITICAL CHECK: fastSeek should NOT be called for 0
    expect(videoElement.fastSeek).not.toHaveBeenCalled();
    expect(videoElement.currentTime).toBe(0);
  });

  it("should bypass fastSeek when dragging slider to 0", () => {
    const { result } = renderHook(() =>
      useVideoPlayer({ src: "test.mp4" })
    );

    // @ts-ignore
    result.current.videoRef.current = videoElement;

    // Initialize duration state
    act(() => {
      // @ts-ignore
      result.current.handleLoadedMetadata({ currentTarget: videoElement });
    });

    // Simulate dragging slider to 0%
    act(() => {
      result.current.handleProgressChangeCommitted(0);
    });

    // CRITICAL CHECK: fastSeek should NOT be called for 0
    expect(videoElement.fastSeek).not.toHaveBeenCalled();
    expect(videoElement.currentTime).toBe(0);
  });
  
  it("should use fastSeek when dragging slider to non-zero", () => {
    const { result } = renderHook(() =>
      useVideoPlayer({ src: "test.mp4" })
    );

    // @ts-ignore
    result.current.videoRef.current = videoElement;

    // Initialize duration state
    act(() => {
      // @ts-ignore
      result.current.handleLoadedMetadata({ currentTarget: videoElement });
    });

    // Simulate dragging slider to 50%
    act(() => {
      result.current.handleProgressChangeCommitted(50);
    });

    expect(videoElement.fastSeek).toHaveBeenCalledWith(50);
  });
});
