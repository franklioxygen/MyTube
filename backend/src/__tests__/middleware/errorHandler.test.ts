import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DownloadError,
  ServiceError,
  ValidationError,
  NotFoundError,
  DuplicateError,
} from '../../errors/DownloadErrors';
import { errorHandler, asyncHandler } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ErrorHandler Middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = {};
    res = {
      json,
      status,
    };
    next = vi.fn();
  });

  describe('errorHandler', () => {
    it('should handle DownloadError with 400 status', () => {
      const error = new DownloadError('network', 'Network error', true);

      errorHandler(error, req as Request, res as Response, next);

      expect(logger.warn).toHaveBeenCalledWith(
        '[DownloadError] network: Network error'
      );
      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({
        error: 'Network error',
        type: 'network',
        recoverable: true,
      });
    });

    it('should handle ServiceError with 400 status by default', () => {
      const error = new ServiceError('validation', 'Invalid input', false);

      errorHandler(error, req as Request, res as Response, next);

      expect(logger.warn).toHaveBeenCalledWith(
        '[ServiceError] validation: Invalid input'
      );
      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({
        error: 'Invalid input',
        type: 'validation',
        recoverable: false,
      });
    });

    it('should handle NotFoundError with 404 status', () => {
      const error = new NotFoundError('Video', 'video-123');

      errorHandler(error, req as Request, res as Response, next);

      expect(logger.warn).toHaveBeenCalledWith(
        '[ServiceError] not_found: Video not found: video-123'
      );
      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({
        error: 'Video not found: video-123',
        type: 'not_found',
        recoverable: false,
      });
    });

    it('should handle DuplicateError with 409 status', () => {
      const error = new DuplicateError('Subscription', 'Already exists');

      errorHandler(error, req as Request, res as Response, next);

      expect(logger.warn).toHaveBeenCalledWith(
        '[ServiceError] duplicate: Already exists'
      );
      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith({
        error: 'Already exists',
        type: 'duplicate',
        recoverable: false,
      });
    });

    it('should handle ServiceError with execution type and 500 status', () => {
      const error = new ServiceError('execution', 'Execution failed', false);

      errorHandler(error, req as Request, res as Response, next);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        error: 'Execution failed',
        type: 'execution',
        recoverable: false,
      });
    });

    it('should handle ServiceError with database type and 500 status', () => {
      const error = new ServiceError('database', 'Database error', false);

      errorHandler(error, req as Request, res as Response, next);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        error: 'Database error',
        type: 'database',
        recoverable: false,
      });
    });

    it('should handle ServiceError with migration type and 500 status', () => {
      const error = new ServiceError('migration', 'Migration failed', false);

      errorHandler(error, req as Request, res as Response, next);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        error: 'Migration failed',
        type: 'migration',
        recoverable: false,
      });
    });

    it('should handle unknown errors with 500 status', () => {
      const error = new Error('Unexpected error');

      errorHandler(error, req as Request, res as Response, next);

      expect(logger.error).toHaveBeenCalledWith('Unhandled error', error);
      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: undefined,
      });
    });

    it('should include error message in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const error = new Error('Unexpected error');

      errorHandler(error, req as Request, res as Response, next);

      expect(json).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'Unexpected error',
      });

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('asyncHandler', () => {
    it('should wrap async function and catch errors', async () => {
      const asyncFn = vi.fn().mockRejectedValue(new Error('Test error'));
      const wrapped = asyncHandler(asyncFn);
      const next = vi.fn();

      await wrapped(req as Request, res as Response, next);

      expect(asyncFn).toHaveBeenCalledWith(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should pass through successful async function', async () => {
      const asyncFn = vi.fn().mockResolvedValue(undefined);
      const wrapped = asyncHandler(asyncFn);
      const next = vi.fn();

      await wrapped(req as Request, res as Response, next);

      expect(asyncFn).toHaveBeenCalledWith(req, res, next);
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle promise rejections from async functions', async () => {
      const asyncFn = vi.fn().mockRejectedValue(new Error('Async error'));
      const wrapped = asyncHandler(asyncFn);
      const next = vi.fn();

      await wrapped(req as Request, res as Response, next);

      expect(asyncFn).toHaveBeenCalledWith(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0][0] as Error).message).toBe('Async error');
    });
  });
});

