import '@testing-library/jest-dom';
import { vi } from 'vitest';

const createMemoryStorage = (): Storage => {
  let store: Record<string, string> = {};

  return {
    get length() {
      return Object.keys(store).length;
    },
    clear: vi.fn(() => {
      store = {};
    }),
    getItem: vi.fn((key: string) => store[key] ?? null),
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = String(value);
    }),
  };
};

try {
  void window.localStorage;
} catch {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: createMemoryStorage(),
  });
}

if (!window.localStorage) {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: createMemoryStorage(),
  });
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: window.localStorage,
});

// Mock matchMedia for MUI
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// jsdom does not implement media playback or scrollTo. Without these stubs,
// jsdom emits "Not implemented" errors via its virtual console, which vitest
// forwards to the main process as onUserConsoleLog RPC calls. Media cleanup
// (e.g. pausing a <video> on unmount) can run asynchronously after a test has
// finished, so that log RPC can be in flight exactly as the worker tears down
// its environment — producing the flaky
// "EnvironmentTeardownError: Closing rpc while 'onUserConsoleLog' was pending".
// Stubbing the unimplemented methods removes the noise and the race.
Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  writable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});
Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});
