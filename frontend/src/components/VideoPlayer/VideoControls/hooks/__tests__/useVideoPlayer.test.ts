import React, { useEffect } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoPlayer } from "../useVideoPlayer";

const HookHarness = ({
  props,
  onReady,
}: {
  props: Parameters<typeof useVideoPlayer>[0];
  onReady: (hook: ReturnType<typeof useVideoPlayer>) => void;
}) => {
  const hook = useVideoPlayer(props);

  useEffect(() => {
    onReady(hook);
  }, [hook, onReady]);

  return React.createElement("video", {
    "data-testid": "player",
    ref: hook.videoRef,
  });
};

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

  it("should not seek again when startTime changes during active playback", () => {
    const { result, rerender } = renderHook(
      (props) => useVideoPlayer(props),
      {
        initialProps: { src: "test.mp4", startTime: 0 }
      }
    );

    result.current.videoRef.current = videoElement;

    act(() => {
      result.current.handleLoadedMetadata({ currentTarget: videoElement } as React.SyntheticEvent<HTMLVideoElement>);
    });

    videoElement.fastSeek = vi.fn();
    videoElement.currentTime = 35;

    rerender({ src: "test.mp4", startTime: 35 });

    expect(videoElement.fastSeek).not.toHaveBeenCalled();
    expect(videoElement.currentTime).toBe(35);
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

describe("useVideoPlayer lifecycle and interaction behavior", () => {
  let videoElement: HTMLVideoElement;

  beforeEach(() => {
    videoElement = screen.queryByTestId("player") as HTMLVideoElement;
  });

  const setupVideoElement = () => {
    videoElement = screen.getByTestId("player") as HTMLVideoElement;
    Object.defineProperty(videoElement, "duration", {
      configurable: true,
      writable: true,
      value: 100,
    });
    Object.defineProperty(videoElement, "currentTime", {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(videoElement, "playbackRate", {
      configurable: true,
      writable: true,
      value: 1,
    });
    videoElement.play = vi.fn().mockResolvedValue(undefined);
    videoElement.pause = vi.fn();
    videoElement.load = vi.fn();
    videoElement.fastSeek = vi.fn();
    return videoElement;
  };

  it("cleans up the previous source and resets state when src changes", async () => {
    let latestHook!: ReturnType<typeof useVideoPlayer>;
    const onReady = (hook: ReturnType<typeof useVideoPlayer>) => {
      latestHook = hook;
    };

    const { rerender } = render(
      React.createElement(HookHarness, {
        props: { src: "first.mp4" },
        onReady,
      })
    );

    const player = setupVideoElement();

    act(() => {
      latestHook.handleLoadedMetadata({ currentTarget: player } as React.SyntheticEvent<HTMLVideoElement>);
      player.currentTime = 25;
      latestHook.handleTimeUpdate({ currentTarget: player } as React.SyntheticEvent<HTMLVideoElement>);
      latestHook.handlePlay();
    });

    rerender(
      React.createElement(HookHarness, {
        props: { src: "second.mp4" },
        onReady,
      })
    );

    await waitFor(() => {
      expect(player.pause).toHaveBeenCalled();
      expect(player.load).toHaveBeenCalled();
      expect(latestHook.isPlaying).toBe(false);
      expect(latestHook.currentTime).toBe(0);
      expect(latestHook.duration).toBe(0);
    });
  });

  it("applies autoplay and loop settings when they change", async () => {
    let latestHook!: ReturnType<typeof useVideoPlayer>;
    const { rerender } = render(
      React.createElement(HookHarness, {
        props: { src: "test.mp4", autoPlay: false, autoLoop: false },
        onReady: (hook: ReturnType<typeof useVideoPlayer>) => {
          latestHook = hook;
        },
      })
    );

    const player = setupVideoElement();

    rerender(
      React.createElement(HookHarness, {
        props: { src: "test.mp4", autoPlay: true, autoLoop: true },
        onReady: (hook: ReturnType<typeof useVideoPlayer>) => {
          latestHook = hook;
        },
      })
    );

    await waitFor(() => {
      expect(player.autoplay).toBe(true);
      expect(player.loop).toBe(true);
      expect(latestHook.isLooping).toBe(true);
    });
  });

  it("updates duration from durationchange events and canplay within tolerance", async () => {
    let latestHook!: ReturnType<typeof useVideoPlayer>;
    render(
      React.createElement(HookHarness, {
        props: { src: "test.mp4" },
        onReady: (hook: ReturnType<typeof useVideoPlayer>) => {
          latestHook = hook;
        },
      })
    );

    const player = setupVideoElement();
    player.duration = 100;
    fireEvent(player, new Event("durationchange"));

    await waitFor(() => {
      expect(latestHook.duration).toBe(100);
    });

    player.duration = 105;
    act(() => {
      latestHook.handleCanPlay();
    });

    expect(latestHook.duration).toBe(105);
  });

  it("toggles playback and loop state through handlers", () => {
    const { result } = renderHook(() => useVideoPlayer({ src: "test.mp4" }));
    const player = document.createElement("video");
    player.play = vi.fn().mockResolvedValue(undefined);
    player.pause = vi.fn();
    Object.defineProperty(player, "loop", {
      configurable: true,
      writable: true,
      value: false,
    });
    result.current.videoRef.current = player;

    act(() => {
      result.current.handlePlayPause();
    });
    expect(player.play).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(true);

    act(() => {
      result.current.handlePlayPause();
    });
    expect(player.pause).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);

    act(() => {
      result.current.handleToggleLoop();
    });
    expect(player.loop).toBe(true);
    expect(result.current.isLooping).toBe(true);
  });

  it("falls back to currentTime when fastSeek is unavailable", () => {
    const { result } = renderHook(() => useVideoPlayer({ src: "test.mp4" }));
    const player = document.createElement("video");
    Object.defineProperty(player, "duration", {
      configurable: true,
      writable: true,
      value: 100,
    });
    Object.defineProperty(player, "currentTime", {
      configurable: true,
      writable: true,
      value: 50,
    });
    // @ts-expect-error test fallback path
    player.fastSeek = undefined;
    result.current.videoRef.current = player;

    act(() => {
      result.current.handleLoadedMetadata({ currentTarget: player } as React.SyntheticEvent<HTMLVideoElement>);
    });

    act(() => {
      result.current.handleSeek(-20);
    });

    act(() => {
      result.current.handleProgressChangeCommitted(25);
    });

    expect(player.currentTime).toBe(25);
  });

  it("tracks dragging and seeking state around time updates", () => {
    const onTimeUpdate = vi.fn();
    const { result } = renderHook(() =>
      useVideoPlayer({ src: "test.mp4", onTimeUpdate })
    );
    const player = document.createElement("video");
    Object.defineProperty(player, "duration", {
      configurable: true,
      writable: true,
      value: 100,
    });
    Object.defineProperty(player, "currentTime", {
      configurable: true,
      writable: true,
      value: 10,
    });
    result.current.videoRef.current = player;

    act(() => {
      result.current.handleLoadedMetadata({ currentTarget: player } as React.SyntheticEvent<HTMLVideoElement>);
    });

    act(() => {
      result.current.handleProgressMouseDown();
    });

    act(() => {
      result.current.handleTimeUpdate({ currentTarget: player } as React.SyntheticEvent<HTMLVideoElement>);
    });

    expect(result.current.isDragging).toBe(true);
    expect(result.current.currentTime).toBe(0);
    expect(onTimeUpdate).not.toHaveBeenCalled();

    act(() => {
      result.current.handleProgressChangeCommitted(50);
      result.current.handleSeeking();
    });

    act(() => {
      player.currentTime = 30;
      result.current.handleTimeUpdate({ currentTarget: player } as React.SyntheticEvent<HTMLVideoElement>);
      result.current.handleSeeked({ currentTarget: player } as React.SyntheticEvent<HTMLVideoElement>);
    });

    expect(result.current.isDragging).toBe(false);
    expect(result.current.currentTime).toBe(30);
    expect(onTimeUpdate).toHaveBeenCalledWith(30);
  });

  it("returns the existing loop state when no video element is attached", () => {
    const { result } = renderHook(() =>
      useVideoPlayer({ src: "test.mp4", autoLoop: true })
    );

    let loopState = false;
    act(() => {
      loopState = result.current.handleToggleLoop();
    });

    expect(loopState).toBe(true);
    expect(result.current.isLooping).toBe(true);
  });
});
