import { describe, expect, it } from 'vitest';
import {
    DatabaseError,
    DownloadCancelledError,
    DownloadError,
    DuplicateError,
    ExecutionError,
    FileError,
    MigrationError,
    NetworkError,
    NotFoundError,
    ServiceError,
    SubtitleError,
    ValidationError,
    YtDlpError,
    isAnyCancellationError,
    isCancelledError,
    isDownloadError,
    isNotFoundError,
    isServiceError,
    isValidationError
} from '../DownloadErrors';

describe('DownloadErrors', () => {
  describe('DownloadError Base Class', () => {
    it('should create base error correctly', () => {
      const error = new DownloadError('unknown', 'test error', true);
      expect(error.type).toBe('unknown');
      expect(error.message).toBe('test error');
      expect(error.recoverable).toBe(true);
      expect(error.name).toBe('DownloadError');
      expect(error instanceof Error).toBe(true);
    });

    it('should verify type with isType', () => {
      const error = new DownloadError('network', 'test', true);
      expect(error.isType('network')).toBe(true);
      expect(error.isType('file')).toBe(false);
    });

    it('should create unknown error via static factory', () => {
      const error = DownloadError.unknown('something happened');
      expect(error.type).toBe('unknown');
      expect(error.message).toBe('something happened');
      expect(error.recoverable).toBe(false);
    });
  });

  describe('DownloadCancelledError', () => {
    it('should create with default message', () => {
      const error = new DownloadCancelledError();
      expect(error.type).toBe('cancelled');
      expect(error.message).toBe('Download cancelled by user');
      expect(error.recoverable).toBe(false);
      expect(error.name).toBe('DownloadCancelledError');
    });

    it('should create with custom message', () => {
      const error = new DownloadCancelledError('Custom cancel');
      expect(error.message).toBe('Custom cancel');
    });

    it('should create via static factory', () => {
      const error = DownloadCancelledError.create();
      expect(error).toBeInstanceOf(DownloadCancelledError);
    });
  });

  describe('YtDlpError', () => {
    it('should create with message and original error', () => {
      const original = new Error('root cause');
      const error = new YtDlpError('failed', original);
      expect(error.type).toBe('ytdlp');
      expect(error.originalError).toBe(original);
      expect(error.recoverable).toBe(false);
    });

    it('should create from error', () => {
      const original = new Error('oops');
      const error = YtDlpError.fromError(original);
      expect(error.message).toBe('oops');
      expect(error.originalError).toBe(original);
    });
  });

  describe('SubtitleError', () => {
    it('should be recoverable', () => {
      const error = new SubtitleError('failed');
      expect(error.recoverable).toBe(true);
      expect(error.type).toBe('subtitle');
    });
  });

  describe('NetworkError', () => {
    it('should be recoverable', () => {
      const error = new NetworkError('failed');
      expect(error.recoverable).toBe(true);
      expect(error.type).toBe('network');
    });

    it('should store status code', () => {
      const error = new NetworkError('failed', 404);
      expect(error.statusCode).toBe(404);
    });

    it('should create via static factories', () => {
      expect(NetworkError.timeout().message).toBe('Request timed out');
      expect(NetworkError.withStatus('fail', 500).statusCode).toBe(500);
    });
  });

  describe('FileError', () => {
    it('should create with file path', () => {
      const error = new FileError('failed', '/path/to/file');
      expect(error.filePath).toBe('/path/to/file');
      expect(error.recoverable).toBe(false);
    });

    it('should create via static factories', () => {
      const err1 = FileError.notFound('/file');
      expect(err1.message).toContain('File not found');
      expect(err1.filePath).toBe('/file');

      const err2 = FileError.writeError('/file', 'EPERM');
      expect(err2.message).toContain('EPERM');
    });
  });

  describe('Type Guards', () => {
    it('isDownloadError should identify DownloadErrors', () => {
      expect(isDownloadError(new DownloadError('unknown', 'test'))).toBe(true);
      expect(isDownloadError(new Error('test'))).toBe(false);
    });

    it('isCancelledError should identify DownloadCancelledError', () => {
      expect(isCancelledError(new DownloadCancelledError())).toBe(true);
      expect(isCancelledError(new DownloadError('cancelled', 'test'))).toBe(false); // Note: Base class with 'cancelled' type is NOT instance of DownloadCancelledError subclass
    });

    it('isAnyCancellationError should identify various cancellation signals', () => {
      expect(isAnyCancellationError(new DownloadCancelledError())).toBe(true);
      
      const errWithCode = new Error('killed');
      (errWithCode as any).code = 143;
      expect(isAnyCancellationError(errWithCode)).toBe(true);

      const errWithMsg = new Error('Download cancelled by user');
      expect(isAnyCancellationError(errWithMsg)).toBe(true);
      
      expect(isAnyCancellationError(new Error('other'))).toBe(false);
    });
  });

  describe('ServiceError', () => {
    it('should verify type with isType', () => {
        const error = new ServiceError('validation', 'test');
        expect(error.isType('validation')).toBe(true);
    });

    it('isServiceError should identify ServiceErrors', () => {
        expect(isServiceError(new ServiceError('unknown', 'test'))).toBe(true);
        expect(isServiceError(new Error('test'))).toBe(false);
    });
  });

  describe('Specific Service Errors', () => {
      it('ValidationError', () => {
          const err = new ValidationError('bad input', 'field1');
          expect(err.field).toBe('field1');
          expect(isValidationError(err)).toBe(true);
          
          expect(ValidationError.invalidUrl('abc').message).toContain('Invalid URL');
      });

      it('NotFoundError', () => {
          const err = new NotFoundError('User', '123');
          expect(err.resource).toBe('User');
          expect(err.resourceId).toBe('123');
          expect(isNotFoundError(err)).toBe(true);
      });

      it('DuplicateError', () => {
          const err = new DuplicateError('User');
          expect(err.message).toContain('User already exists');
      });
      
      it('DatabaseError', () => {
          const err = new DatabaseError('db fail', undefined, 'insert');
          expect(err.operation).toBe('insert');
          expect(err.recoverable).toBe(true);
      });

      it('ExecutionError', () => {
          const err = ExecutionError.fromCommand('ls', new Error('fail'), 1);
          expect(err.command).toBe('ls');
          expect(err.exitCode).toBe(1);
      });

      it('MigrationError', () => {
          const err = MigrationError.fromError(new Error('fail'), '001');
          expect(err.step).toBe('001');
      });
  });
});
