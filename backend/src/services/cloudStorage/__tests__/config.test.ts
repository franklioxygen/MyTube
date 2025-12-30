import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as storageService from '../../storageService';
import { getConfig, isConfigured } from '../config';

describe('cloudStorage config', () => {
  const getSettingsMock = vi.spyOn(storageService, 'getSettings');

  beforeEach(() => {
    getSettingsMock.mockReset();
  });

  describe('getConfig', () => {
    it('should return default values when settings are empty', () => {
      getSettingsMock.mockReturnValue({});
      
      const config = getConfig();
      
      expect(config.enabled).toBe(false);
      expect(config.apiUrl).toBe('');
      expect(config.token).toBe('');
      expect(config.publicUrl).toBeUndefined();
      expect(config.uploadPath).toBe('/');
      expect(config.scanPaths).toBeUndefined();
    });

    it('should parse valid settings', () => {
      getSettingsMock.mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: 'secret-token',
        openListPublicUrl: 'https://public.example.com',
        cloudDrivePath: '/uploads',
      });
      
      const config = getConfig();
      
      expect(config.enabled).toBe(true);
      expect(config.apiUrl).toBe('https://api.example.com');
      expect(config.token).toBe('secret-token');
      expect(config.publicUrl).toBe('https://public.example.com');
      expect(config.uploadPath).toBe('/uploads');
    });

    it('should parse scan paths', () => {
      getSettingsMock.mockReturnValue({
        cloudDriveScanPaths: '/path/1\n/path/2\n  /path/3  \n\n',
      });
      
      const config = getConfig();
      
      expect(config.scanPaths).toEqual(['/path/1', '/path/2', '/path/3']);
    });

    it('should ignore invalid scan paths', () => {
      getSettingsMock.mockReturnValue({
        cloudDriveScanPaths: 'invalid/path\n/valid/path',
      });
      
      const config = getConfig();
      
      expect(config.scanPaths).toEqual(['/valid/path']);
    });
    
    it('should set scanPaths to undefined if no valid paths exist', () => {
         getSettingsMock.mockReturnValue({
            cloudDriveScanPaths: 'invalid/path\n',
          });
          
          const config = getConfig();
          
          expect(config.scanPaths).toBeUndefined();
    });
  });

  describe('isConfigured', () => {
    it('should return true when enabled and required fields are present', () => {
      const config = {
        enabled: true,
        apiUrl: 'url',
        token: 'token',
      } as any;
      expect(isConfigured(config)).toBe(true);
    });

    it('should return false when disabled', () => {
      const config = {
        enabled: false,
        apiUrl: 'url',
        token: 'token',
      } as any;
      expect(isConfigured(config)).toBe(false);
    });

    it('should return false when missing api url', () => {
      const config = {
        enabled: true,
        apiUrl: '',
        token: 'token',
      } as any;
      expect(isConfigured(config)).toBe(false);
    });

    it('should return false when missing token', () => {
      const config = {
        enabled: true,
        apiUrl: 'url',
        token: '',
      } as any;
      expect(isConfigured(config)).toBe(false);
    });
  });
});
