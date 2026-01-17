import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as loginAttemptService from '../../services/loginAttemptService';
import * as passwordService from '../../services/passwordService';
import * as storageService from '../../services/storageService';
import { logger } from '../../utils/logger';

// Mock dependencies
vi.mock('../../services/loginAttemptService');
vi.mock('../../services/storageService');
vi.mock('../../utils/logger');
vi.mock('bcryptjs', () => ({
    default: {
        compare: vi.fn(),
        hash: vi.fn(),
        genSalt: vi.fn(),
    }
}));
vi.mock('crypto', () => ({
    default: {
        randomBytes: vi.fn().mockReturnValue(Buffer.from('abcdefgh')),
    }
}));

describe('passwordService', () => {
  const mockSettings = {
    loginEnabled: true,
    password: 'hashedVideoPassword',
    hostname: 'test',
    port: 3000
    // add other required settings if needed
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    (storageService.getSettings as any).mockReturnValue(mockSettings);
    (loginAttemptService.canAttemptLogin as any).mockReturnValue(0); // No wait time
    (loginAttemptService.recordFailedAttempt as any).mockReturnValue(60); // 1 min wait default
    (loginAttemptService.getFailedAttempts as any).mockReturnValue(1);
    
    (bcrypt.compare as any).mockResolvedValue(false);
    (bcrypt.hash as any).mockResolvedValue('hashed_new');
    (bcrypt.genSalt as any).mockResolvedValue('salt');
  });

  describe('isPasswordEnabled', () => {
    it('should return true if configured', () => {
      const result = passwordService.isPasswordEnabled();
      expect(result.enabled).toBe(true);
      expect(result.waitTime).toBeUndefined();
    });

    it('should return false if login disabled', () => {
      (storageService.getSettings as any).mockReturnValue({ ...mockSettings, loginEnabled: false });
      const result = passwordService.isPasswordEnabled();
      expect(result.enabled).toBe(false);
    });

    it('should return wait time if locked out', () => {
      (loginAttemptService.canAttemptLogin as any).mockReturnValue(300);
      const result = passwordService.isPasswordEnabled();
      expect(result.waitTime).toBe(300);
    });
  });

  describe('verifyPassword', () => {
    it('should return success for correct password', async () => {
      (bcrypt.compare as any).mockResolvedValue(true);
      
      const result = await passwordService.verifyPassword('correct');
      
      expect(result.success).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith('correct', 'hashedVideoPassword');
      expect(loginAttemptService.resetFailedAttempts).toHaveBeenCalled();
    });

    it('should return failure for incorrect password', async () => {
      (bcrypt.compare as any).mockResolvedValue(false);
      
      const result = await passwordService.verifyPassword('wrong');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Incorrect password');
      expect(loginAttemptService.recordFailedAttempt).toHaveBeenCalled();
      expect(result.waitTime).toBe(60);
    });

    it('should block if wait time exists', async () => {
      (loginAttemptService.canAttemptLogin as any).mockReturnValue(120);
      
      const result = await passwordService.verifyPassword('any');
      
      expect(result.success).toBe(false);
      expect(result.waitTime).toBe(120);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should succeed if no password set but enabled', async () => {
      (storageService.getSettings as any).mockReturnValue({ ...mockSettings, password: '' });
      
      const result = await passwordService.verifyPassword('any');
      
      expect(result.success).toBe(true);
    });
  });

  describe('resetPassword', () => {
    it('should generate new password, hash it, save settings, and log it', async () => {
      const newPass = await passwordService.resetPassword();
      
      // Verify random bytes were used (mocked 'abcdefgh' -> mapped to chars)
      expect(newPass).toBeDefined();
      expect(newPass.length).toBe(8);
      
      expect(bcrypt.hash).toHaveBeenCalledWith(newPass, 'salt');
      expect(storageService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
          password: 'hashed_new',
          loginEnabled: true
      }));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'));
      expect(loginAttemptService.resetFailedAttempts).toHaveBeenCalled();
    });
  });
});
