import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteLegacyData, getSettings, migrateData, patchSettings, updateSettings } from '../../controllers/settingsController';
import { verifyPassword } from '../../controllers/passwordController';
import downloadManager from '../../services/downloadManager';
import * as storageService from '../../services/storageService';

vi.mock('../../services/storageService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/storageService')>();
  return {
    ...actual,
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    formatLegacyFilenames: vi.fn(),
  };
});
vi.mock('../../services/downloadManager');
vi.mock('../../services/passwordService');
vi.mock('bcryptjs');
vi.mock('fs-extra');
vi.mock('../../services/migrationService', () => ({
  runMigration: vi.fn(),
}));

describe('SettingsController', () => {
  const originalTrustLevel = process.env.MYTUBE_ADMIN_TRUST_LEVEL;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  afterEach(() => {
    if (originalTrustLevel === undefined) {
      delete process.env.MYTUBE_ADMIN_TRUST_LEVEL;
    } else {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = originalTrustLevel;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = {};
    res = {
      json,
      status,
      cookie: vi.fn(),
    };
  });

  describe('getSettings', () => {
    it('should return settings', async () => {
      (storageService.getSettings as any).mockReturnValue({ theme: 'dark' });

      await getSettings(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentSecurity: expect.objectContaining({
            adminTrustLevel: 'container',
          }),
        })
      );
    });

    it('should hide api key from visitor users', async () => {
      req.user = { role: 'visitor' } as any;
      (storageService.getSettings as any).mockReturnValue({
        loginEnabled: true,
        apiKeyEnabled: true,
        apiKey: 'super-secret-api-key',
      });

      await getSettings(req as Request, res as Response);

      const responsePayload = json.mock.calls[0][0];
      expect(responsePayload.apiKey).toBeUndefined();
      expect(responsePayload.apiKeyEnabled).toBeUndefined();
    });

    it('should expose admin-only settings when login is disabled', async () => {
      (storageService.getSettings as any).mockReturnValue({
        loginEnabled: false,
        apiKeyEnabled: true,
        apiKey: 'super-secret-api-key',
        openListToken: 'openlist-token',
        cloudflaredToken: 'cloudflared-token',
        telegramBotToken: 'telegram-token',
        twitchClientId: 'twitch-client-id',
        twitchClientSecret: 'twitch-client-secret',
      });

      await getSettings(req as Request, res as Response);

      const responsePayload = json.mock.calls[0][0];
      expect(responsePayload.apiKey).toBe('super-secret-api-key');
      expect(responsePayload.apiKeyEnabled).toBe(true);
      expect(responsePayload.openListToken).toBe('openlist-token');
      expect(responsePayload.cloudflaredToken).toBe('cloudflared-token');
      expect(responsePayload.telegramBotToken).toBe('telegram-token');
      expect(responsePayload.twitchClientId).toBe('twitch-client-id');
      expect(responsePayload.twitchClientSecret).toBe('twitch-client-secret');
    });

    it('should not expose stored passkeys in settings response', async () => {
      (storageService.getSettings as any).mockReturnValue({
        loginEnabled: true,
        internalOnlySetting: 'secret',
        passkeys: [
          {
            credentialID: 'cred-1',
            credentialPublicKey: 'pub',
            counter: 1,
            rpID: 'example.com',
            origin: 'https://example.com',
          },
        ],
      });

      await getSettings(req as Request, res as Response);

      const responsePayload = json.mock.calls[0][0];
      expect(responsePayload.passkeys).toBeUndefined();
      expect(responsePayload.internalOnlySetting).toBeUndefined();
    });

    it('should save defaults if empty', async () => {
      (storageService.getSettings as any).mockReturnValue({});

      await getSettings(req as Request, res as Response);

      expect(storageService.saveSettings).toHaveBeenCalled();
      expect(json).toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    it('should update settings', async () => {
      req.body = { theme: 'light', maxConcurrentDownloads: 5 };
      (storageService.getSettings as any).mockReturnValue({});

      await updateSettings(req as Request, res as Response);

      expect(storageService.saveSettings).toHaveBeenCalled();
      expect(downloadManager.setMaxConcurrentDownloads).toHaveBeenCalledWith(5);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should hash password if provided', async () => {
      req.body = { password: 'pass' };
      (storageService.getSettings as any).mockReturnValue({});
      const passwordService = await import('../../services/passwordService');
      (passwordService.hashPassword as any).mockResolvedValue('hashed');

      await updateSettings(req as Request, res as Response);

      expect(passwordService.hashPassword).toHaveBeenCalledWith('pass');
      expect(storageService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ password: 'hashed' }));
    });

    it('should validate and update itemsPerPage', async () => {
      req.body = { itemsPerPage: -5 };
      (storageService.getSettings as any).mockReturnValue({});

      await updateSettings(req as Request, res as Response);

      expect(storageService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ itemsPerPage: 12 }));
      
      req.body = { itemsPerPage: 20 };
      await updateSettings(req as Request, res as Response);
      expect(storageService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ itemsPerPage: 20 }));
    });
  });

  describe('patchSettings', () => {
    it('should persist only changed fields', async () => {
      req.body = { theme: 'light' };
      (storageService.getSettings as any).mockReturnValue({
        theme: 'dark',
        language: 'en',
      });

      await patchSettings(req as Request, res as Response);

      expect(storageService.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ theme: 'light' })
      );
      const savedPayload = (storageService.saveSettings as any).mock.calls[0][0];
      expect(savedPayload.language).toBeUndefined();
      expect(savedPayload.maxConcurrentDownloads).toBeUndefined();
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should hash password and never persist plaintext password', async () => {
      req.body = { password: 'pass' };
      (storageService.getSettings as any).mockReturnValue({});
      const passwordService = await import('../../services/passwordService');
      (passwordService.hashPassword as any).mockResolvedValue('hashed');

      await patchSettings(req as Request, res as Response);

      const savedPayload = (storageService.saveSettings as any).mock.calls[0][0];
      expect(savedPayload.password).toBe('hashed');
      expect(savedPayload.password).not.toBe('pass');
    });

    it('should generate api key when api key auth is enabled without a key', async () => {
      req.body = { apiKeyEnabled: true, apiKey: '' };
      (storageService.getSettings as any).mockReturnValue({
        loginEnabled: true,
      });

      await patchSettings(req as Request, res as Response);

      const savedPayload = (storageService.saveSettings as any).mock.calls[0][0];
      expect(savedPayload.apiKeyEnabled).toBe(true);
      expect(savedPayload.apiKey).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should reject raw yt-dlp config changes in application trust mode', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'application';
      req.body = { ytDlpConfig: '--exec echo hi' };
      (storageService.getSettings as any).mockReturnValue({
        ytDlpConfig: '',
      });

      await patchSettings(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(403);
      expect(storageService.saveSettings).not.toHaveBeenCalled();
    });

    it('should reject mount directory changes unless trust level is host', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'container';
      req.body = { mountDirectories: '/mnt/videos' };
      (storageService.getSettings as any).mockReturnValue({
        mountDirectories: '',
      });

      await patchSettings(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(403);
      expect(storageService.saveSettings).not.toHaveBeenCalled();
    });

    it('should ignore unchanged gated fields when trust level is lower', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'application';
      req.body = {
        ytDlpConfig: '--format best',
        theme: 'light',
      };
      (storageService.getSettings as any).mockReturnValue({
        ytDlpConfig: '--format best',
        theme: 'dark',
      });

      await patchSettings(req as Request, res as Response);

      expect(storageService.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ theme: 'light' })
      );
      const savedPayload = (storageService.saveSettings as any).mock.calls[0][0];
      expect(savedPayload.ytDlpConfig).toBeUndefined();
    });

    it('should treat proxyOnlyYoutube null as unchanged false in application trust mode', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'application';
      req.body = {
        proxyOnlyYoutube: null,
        theme: 'light',
      };
      (storageService.getSettings as any).mockReturnValue({
        proxyOnlyYoutube: false,
        theme: 'dark',
      });

      await patchSettings(req as Request, res as Response);

      expect(storageService.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ theme: 'light' })
      );
      const savedPayload = (storageService.saveSettings as any).mock.calls[0][0];
      expect(savedPayload.proxyOnlyYoutube).toBeUndefined();
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      req.body = { password: 'pass' };
      const passwordService = await import('../../services/passwordService');
      (passwordService.verifyPassword as any).mockResolvedValue({ 
        success: true, 
        token: 'mock-token', 
        role: 'admin' 
      });

      await verifyPassword(req as Request, res as Response);

      expect(passwordService.verifyPassword).toHaveBeenCalledWith('pass');
      expect(json).toHaveBeenCalledWith({ success: true, role: 'admin' });
    });

    it('should reject incorrect password', async () => {
      req.body = { password: 'wrong' };
      const passwordService = await import('../../services/passwordService');
      (passwordService.verifyPassword as any).mockResolvedValue({
        success: false,
        message: 'Incorrect password',
      });

      await verifyPassword(req as Request, res as Response);

      expect(passwordService.verifyPassword).toHaveBeenCalledWith('wrong');
      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith({
        success: false,
        message: 'Incorrect password',
      });
    });
  });

  describe('migrateData', () => {
    it('should run migration', async () => {
      const migrationService = await import('../../services/migrationService');
      (migrationService.runMigration as any).mockResolvedValue({ success: true });

      await migrateData(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ results: { success: true } }));
    });

    it('should handle errors', async () => {
      const migrationService = await import('../../services/migrationService');
      (migrationService.runMigration as any).mockRejectedValue(new Error('Migration failed'));

      try {
        await migrateData(req as Request, res as Response);
        expect.fail('Should have thrown');
      } catch (error: any) {
        // The controller does NOT catch generic errors, it relies on asyncHandler.
        // So here it throws.
        expect(error.message).toBe('Migration failed');
      }
    });
  });

  describe('deleteLegacyData', () => {
    it('should delete legacy files', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.unlinkSync as any).mockImplementation(() => {});

      await deleteLegacyData(req as Request, res as Response);

      expect(fs.unlinkSync).toHaveBeenCalledTimes(4);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ results: expect.anything() }));
    });

    it('should handle errors during deletion', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.unlinkSync as any).mockImplementation(() => {
        throw new Error('Delete failed');
      });

      await deleteLegacyData(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ results: expect.anything() }));
      // It returns success but with failed list
    });
  });
});
