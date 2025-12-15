import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebounce } from "../useDebounce";

describe("useDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("test", 500));
    expect(result.current).toBe("test");
  });

  it("should debounce value changes", async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: "initial", delay: 500 },
      }
    );

    expect(result.current).toBe("initial");

    // Change value
    act(() => {
      rerender({ value: "updated", delay: 500 });
    });

    // Value should still be initial (not debounced yet)
    expect(result.current).toBe("initial");

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Now value should be updated (no waitFor needed with fake timers)
    expect(result.current).toBe("updated");
  });

  it("should reset timer on rapid changes", async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: "first", delay: 500 },
      }
    );

    expect(result.current).toBe("first");

    // Rapid changes
    act(() => {
      rerender({ value: "second", delay: 500 });
      vi.advanceTimersByTime(300);
    });

    act(() => {
      rerender({ value: "third", delay: 500 });
      vi.advanceTimersByTime(300);
    });

    // Should still be 'first' because timer keeps resetting
    expect(result.current).toBe("first");

    // Wait for full delay after last change
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Value should be updated (no waitFor needed with fake timers)
    expect(result.current).toBe("third");
  });

  it("should handle different delay values", async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: "test", delay: 1000 },
      }
    );

    act(() => {
      rerender({ value: "updated", delay: 1000 });
    });

    // Advance less than delay
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe("test");

    // Advance to full delay
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe("updated");
  });

  it("should handle number values", async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 0, delay: 500 },
      }
    );

    expect(result.current).toBe(0);

    act(() => {
      rerender({ value: 100, delay: 500 });
    });

    // Value should still be 0 (not debounced yet)
    expect(result.current).toBe(0);

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toBe(100);
  });

  it("should handle object values", async () => {
    const obj1 = { id: 1, name: "test" };
    const obj2 = { id: 2, name: "updated" };

    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: obj1, delay: 500 },
      }
    );

    expect(result.current).toBe(obj1);

    act(() => {
      rerender({ value: obj2, delay: 500 });
    });

    // Value should still be obj1 (not debounced yet)
    expect(result.current).toBe(obj1);

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toBe(obj2);
  });
});
