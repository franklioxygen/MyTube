import { describe, expect, it, vi } from "vitest";
import { drawFailureNotice, wrapLines } from "../failureNotice";

/** Monospace stand-in: every character is 10 units wide. */
const measure = (line: string) => line.length * 10;

describe("wrapLines", () => {
  it("keeps a short line intact", () => {
    expect(wrapLines("no sound", 200, measure)).toEqual(["no sound"]);
  });

  it("breaks on word boundaries at the width limit", () => {
    expect(wrapLines("this video cannot be played", 120, measure)).toEqual([
      "this video",
      "cannot be",
      "played",
    ]);
  });

  it("leaves an over-long word on its own line rather than splitting it", () => {
    // Codec ids and file paths stay readable when they are not chopped up.
    expect(wrapLines("codec V_MPEGH/ISO/HEVC here", 100, measure)).toEqual([
      "codec",
      "V_MPEGH/ISO/HEVC",
      "here",
    ]);
  });

  it("collapses surrounding whitespace and handles empty input", () => {
    expect(wrapLines("  a   b  ", 999, measure)).toEqual(["a b"]);
    expect(wrapLines("   ", 999, measure)).toEqual([]);
  });
});

describe("drawFailureNotice", () => {
  const fakeCanvas = (width: number, height: number) => {
    const calls: Array<[string, number, number]> = [];
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      measureText: (text: string) => ({ width: measure(text) }),
      fillText: (text: string, x: number, y: number) => calls.push([text, x, y]),
      font: "",
      fillStyle: "",
      textAlign: "",
      textBaseline: "",
    };
    return {
      calls,
      context,
      canvas: {
        width,
        height,
        getContext: () => context,
      } as unknown as HTMLCanvasElement,
    };
  };

  it("never resizes the canvas it draws into", () => {
    const { canvas } = fakeCanvas(1920, 1080);
    drawFailureNotice(canvas, {
      title: "Compatibility playback failed",
      detail: "Unsupported track in this file: A_VORBIS",
      hint: "This video cannot be played on this screen.",
    });

    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
  });

  it("dims the last frame and centres every line horizontally", () => {
    const { canvas, context, calls } = fakeCanvas(1280, 720);
    drawFailureNotice(canvas, {
      title: "Playback failed",
      hint: "Try another video.",
    });

    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1280, 720);
    expect(calls.length).toBeGreaterThan(0);
    for (const [, x] of calls) {
      expect(x).toBe(640);
    }
    expect(calls.map(([text]) => text).join(" ")).toContain("Playback failed");
  });

  it("omits blocks that have no text", () => {
    const { canvas, calls } = fakeCanvas(1280, 720);
    drawFailureNotice(canvas, {
      title: "Playback failed",
      detail: null,
      hint: "",
    });

    expect(calls.map(([text]) => text)).toEqual(["Playback failed"]);
  });

  it("does nothing when the canvas has no area yet", () => {
    const { canvas, context } = fakeCanvas(0, 0);
    drawFailureNotice(canvas, { title: "Playback failed" });

    expect(context.fillRect).not.toHaveBeenCalled();
  });
});
