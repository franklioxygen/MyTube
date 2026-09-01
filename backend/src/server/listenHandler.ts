import { logger } from "../utils/logger";

/**
 * Builds the callback passed to `app.listen`.
 *
 * Express 5 forwards a bind failure (EADDRINUSE, EACCES) to this callback,
 * where Express 4 left it as an unhandled `error` event that crashed the
 * process. A callback that ignores its argument therefore announces a running
 * server and starts the background schedulers with no HTTP listener behind
 * them -- and those timers keep the dead process alive, turning a loud startup
 * failure into a silent one.
 */
export const createListenHandler =
  (
    host: string,
    port: number,
    onListening: () => void,
    exit: (code: number) => void = process.exit
  ) =>
  (error?: Error): void => {
    if (error) {
      logger.error("Failed to bind server:", error);
      exit(1);
      return;
    }

    logger.info(`Server running on ${host}:${port}`);
    onListening();
  };
