import { afterEach, describe, expect, it } from "vitest";
import {
  isOverlayTarget,
  isTypingTarget,
} from "../keyboardShortcutGuards";

// Build the event the window listeners actually receive, so `event.target` is
// whatever the DOM retargets it to rather than something hand-set.
const keyEventFrom = (node: Element | Window): KeyboardEvent => {
  let captured: KeyboardEvent | undefined;
  const listener = (event: Event) => {
    captured = event as KeyboardEvent;
  };
  window.addEventListener("keydown", listener);
  node.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
  );
  window.removeEventListener("keydown", listener);
  if (!captured) {
    throw new Error("keydown never reached the window listener");
  }
  return captured;
};

const mount = (html: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isTypingTarget", () => {
  it("catches a field the event was dispatched from", () => {
    const host = mount("<input />");
    const input = host.querySelector("input")!;

    expect(isTypingTarget(keyEventFrom(input))).toBe(true);
  });

  it("catches a focused field when the event is aimed at window", () => {
    const host = mount("<input />");
    host.querySelector("input")!.focus();

    expect(isTypingTarget(keyEventFrom(window))).toBe(true);
  });

  it("catches a native select", () => {
    const host = mount("<select><option>a</option></select>");
    const select = host.querySelector("select")!;

    expect(isTypingTarget(keyEventFrom(select))).toBe(true);
  });

  it("catches a range input, which is what a MUI slider focuses", () => {
    const host = mount('<input type="range" min="0" max="100" />');
    const slider = host.querySelector("input")!;

    expect(isTypingTarget(keyEventFrom(slider))).toBe(true);
  });

  it("catches contenteditable written without a value", () => {
    const host = mount('<div contenteditable tabindex="0"></div>');
    const editor = host.querySelector("div")!;

    expect(isTypingTarget(keyEventFrom(editor))).toBe(true);
  });

  it("catches a child of an editable region", () => {
    const host = mount('<div contenteditable="true"><span>text</span></div>');
    const child = host.querySelector("span")!;

    expect(isTypingTarget(keyEventFrom(child))).toBe(true);
  });

  it("lets a region marked contenteditable=false through", () => {
    const host = mount('<div contenteditable="false" tabindex="0"></div>');
    const notEditable = host.querySelector("div")!;

    expect(isTypingTarget(keyEventFrom(notEditable))).toBe(false);
  });

  it("lets an ordinary element through", () => {
    const host = mount("<button>play</button>");
    const button = host.querySelector("button")!;

    expect(isTypingTarget(keyEventFrom(button))).toBe(false);
  });
});

describe("isOverlayTarget", () => {
  it("catches a keypress inside a menu", () => {
    const host = mount('<div role="menu"><button>sort</button></div>');
    const item = host.querySelector("button")!;

    expect(isOverlayTarget(keyEventFrom(item))).toBe(true);
  });

  it("catches a keypress outside an open modal", () => {
    mount('<div aria-modal="true" role="dialog"></div><button>play</button>');
    const outside = document.querySelector("button")!;

    expect(isOverlayTarget(keyEventFrom(outside))).toBe(true);
  });

  it("lets a keypress through with no overlay open", () => {
    const host = mount("<button>play</button>");
    const button = host.querySelector("button")!;

    expect(isOverlayTarget(keyEventFrom(button))).toBe(false);
  });
});
