import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as passwordController from '../../controllers/passwordController';
import * as authService from '../../services/authService';
import * as passwordService from '../../services/passwordService';

// Mock dependencies
vi.mock('../../services/passwordService');
vi.mock('../../services/authService', () => ({
  setAuthCookie: vi.fn(),
  clearAuthCookie: vi.fn(),
}));
vi.mock('../../utils/logger'); // if used

describe('passwordController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: any;
  let statusMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    mockReq = {};
    mockRes = {
      json: jsonMock,
      status: statusMock,
      cookie: vi.fn(),
    };
  });

  describe('getPasswordEnabled', () => {
    it('should return result from service with authenticatedRole', async () => {
      const mockResult = { enabled: true };
      (passwordService.isPasswordEnabled as any).mockReturnValue(mockResult);
      mockReq.user = { role: 'visitor' } as any;

      await passwordController.getPasswordEnabled(mockReq as Request, mockRes as Response);

      expect(passwordService.isPasswordEnabled).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        ...mockResult,
        authenticatedRole: 'visitor',
      });
    });

    it('should return null role for unauthenticated requests', async () => {
      (passwordService.isPasswordEnabled as any).mockReturnValue({ enabled: false });

      await passwordController.getPasswordEnabled(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        enabled: false,
        authenticatedRole: null,
      });
    });
  });

  describe('verifyPassword', () => {
    it('should return success: true if verified', async () => {
      mockReq.body = { password: 'pass' };
      (passwordService.verifyPassword as any).mockResolvedValue({ 
        success: true, 
        token: 'mock-token', 
        role: 'admin' 
      });

      await passwordController.verifyPassword(mockReq as Request, mockRes as Response);

      expect(passwordService.verifyPassword).toHaveBeenCalledWith('pass');
      expect(authService.setAuthCookie).toHaveBeenCalledWith(mockRes, 'mock-token', 'admin');
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, role: 'admin' });
    });

    it('should return 401 if incorrect', async () => {
      mockReq.body = { password: 'wrong' };
      (passwordService.verifyPassword as any).mockResolvedValue({ 
          success: false, 
          message: 'Incorrect', 
      });

      await passwordController.verifyPassword(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          message: 'Incorrect',
      }));
    });

  });

  describe('verifyAdminPassword', () => {
    it('should set auth cookie on successful admin verification', async () => {
      mockReq.body = { password: 'admin-pass' };
      (passwordService.verifyAdminPassword as any).mockResolvedValue({
        success: true,
        token: 'admin-token',
        role: 'admin',
      });

      await passwordController.verifyAdminPassword(mockReq as Request, mockRes as Response);

      expect(passwordService.verifyAdminPassword).toHaveBeenCalledWith('admin-pass');
      expect(authService.setAuthCookie).toHaveBeenCalledWith(
        mockRes,
        'admin-token',
        'admin'
      );
      expect(jsonMock).toHaveBeenCalledWith({ success: true, role: 'admin' });
    });

    it('should return 401 for invalid admin password', async () => {
      mockReq.body = { password: 'wrong-admin' };
      (passwordService.verifyAdminPassword as any).mockResolvedValue({
        success: false,
        message: 'invalid',
      });

      await passwordController.verifyAdminPassword(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'invalid',
        })
      );
    });
  });

  describe('verifyVisitorPassword', () => {
    it('should set auth cookie on successful visitor verification', async () => {
      mockReq.body = { password: 'visitor-pass' };
      (passwordService.verifyVisitorPassword as any).mockResolvedValue({
        success: true,
        token: 'visitor-token',
        role: 'visitor',
      });

      await passwordController.verifyVisitorPassword(mockReq as Request, mockRes as Response);

      expect(passwordService.verifyVisitorPassword).toHaveBeenCalledWith('visitor-pass');
      expect(authService.setAuthCookie).toHaveBeenCalledWith(
        mockRes,
        'visitor-token',
        'visitor'
      );
      expect(jsonMock).toHaveBeenCalledWith({ success: true, role: 'visitor' });
    });

    it('should return 401 when visitor verification fails', async () => {
      mockReq.body = { password: 'visitor-pass' };
      (passwordService.verifyVisitorPassword as any).mockResolvedValue({
        success: false,
        message: 'wait',
      });

      await passwordController.verifyVisitorPassword(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'wait',
        })
      );
    });
  });

  describe('confirmAdminPassword', () => {
    it('should return success on valid admin re-authentication', async () => {
      mockReq.body = { password: 'admin-pass' };
      (passwordService.confirmAdminPassword as any).mockResolvedValue({
        success: true,
      });

      await passwordController.confirmAdminPassword(
        mockReq as Request,
        mockRes as Response
      );

      expect(passwordService.confirmAdminPassword).toHaveBeenCalledWith('admin-pass');
      expect(jsonMock).toHaveBeenCalledWith({ success: true });
    });

    it('should return 401 on invalid admin re-authentication', async () => {
      mockReq.body = { password: 'wrong-admin' };
      (passwordService.confirmAdminPassword as any).mockResolvedValue({
        success: false,
        message: 'Incorrect admin password',
      });

      await passwordController.confirmAdminPassword(
        mockReq as Request,
        mockRes as Response
      );

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Incorrect admin password',
      });
    });
  });

  describe('getResetPasswordCooldown', () => {
    it('should return cooldown value from service', async () => {
      (passwordService.getResetPasswordCooldown as any).mockReturnValue(45);

      await passwordController.getResetPasswordCooldown(
        mockReq as Request,
        mockRes as Response
      );

      expect(jsonMock).toHaveBeenCalledWith({ cooldown: 45 });
    });
  });
  describe('logout', () => {
    it('should clear auth cookie and return success message', async () => {
      await passwordController.logout(mockReq as Request, mockRes as Response);

      expect(authService.clearAuthCookie).toHaveBeenCalledWith(mockRes);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Logged out successfully',
      });
    });
  });
});
