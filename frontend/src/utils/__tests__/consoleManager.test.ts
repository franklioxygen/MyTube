import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsoleManager from "../consoleManager";

describe("ConsoleManager", () => {
  let storage: Record<string, string>;
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storage = {};
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => (key in storage ? storage[key] : null),
        setItem: (key: string, value: string) => {
          storage[key] = String(value);
        },
        removeItem: (key: string) => {
          delete storage[key];
        },
        clear: () => {
          storage = {};
        },
      },
    });
    localStorage.clear();
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
  });

  it("initializes with debug mode enabled by default", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    ConsoleManager.init();

    expect(ConsoleManager.getDebugMode()).toBe(true);
    expect(localStorage.getItem("mytube_debug_mode")).toBe("true");
    expect(logSpy).toHaveBeenCalledWith("Debug mode enabled");
  });

  it("loads disabled mode from localStorage and suppresses console output", () => {
    localStorage.setItem("mytube_debug_mode", "false");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    ConsoleManager.init();
    console.info("suppressed-info");

    expect(ConsoleManager.getDebugMode()).toBe(false);
    expect(logSpy).toHaveBeenCalledWith("Debug mode disabled");
    expect(infoSpy).not.toHaveBeenCalledWith("suppressed-info");
  });

  it("can toggle from suppressed to restored console methods", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    ConsoleManager.init();
    ConsoleManager.setDebugMode(false);
    console.warn("hidden");
    expect(warnSpy).not.toHaveBeenCalledWith("hidden");

    ConsoleManager.setDebugMode(true);
    console.warn("visible");
    expect(ConsoleManager.getDebugMode()).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith("visible");
  });

  it("persists mode even if setDebugMode is called before init", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    ConsoleManager.setDebugMode(false);
    expect(ConsoleManager.getDebugMode()).toBe(false);
    expect(localStorage.getItem("mytube_debug_mode")).toBe("false");
    expect(logSpy).toHaveBeenCalledWith("Debug mode disabled");
  });
});
