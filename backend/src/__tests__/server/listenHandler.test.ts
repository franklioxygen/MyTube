import { beforeEach, describe, expect, it, vi } from "vitest";
import { createListenHandler } from "../../server/listenHandler";
import { logger } from "../../utils/logger";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

describe("server/listenHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should announce the server and start background jobs once listening", () => {
    const onListening = vi.fn();
    const exit = vi.fn();

    createListenHandler("0.0.0.0", 5551, onListening, exit)();

    expect(logger.info).toHaveBeenCalledWith("Server running on 0.0.0.0:5551");
    expect(onListening).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  // Express 5 hands a bind failure to the listen callback; Express 4 left it as
  // an unhandled 'error' event that crashed the process. Ignoring the argument
  // would announce a server that is not listening and start the schedulers
  // anyway, whose timers then keep the dead process alive.
  it("should exit without starting background jobs when the port cannot be bound", () => {
    const onListening = vi.fn();
    const exit = vi.fn();
    const error = Object.assign(new Error("listen EADDRINUSE"), {
      code: "EADDRINUSE",
    });

    createListenHandler("0.0.0.0", 5551, onListening, exit)(error);

    expect(logger.error).toHaveBeenCalledWith("Failed to bind server:", error);
    expect(exit).toHaveBeenCalledWith(1);
    expect(onListening).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("should not start background jobs even if exit does not terminate", () => {
    const onListening = vi.fn();

    createListenHandler("0.0.0.0", 5551, onListening, vi.fn())(
      new Error("listen EACCES")
    );

    expect(onListening).not.toHaveBeenCalled();
  });
});
