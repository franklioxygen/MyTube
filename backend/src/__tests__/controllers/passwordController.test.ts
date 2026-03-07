import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as passwordController from '../../controllers/passwordController';
import * as authService from '../../services/authService';
import * as passwordService from '../../services/passwordService';
import * as securityAuditService from '../../services/securityAuditService';

// Mock dependencies
vi.mock('../../services/passwordService');
vi.mock('../../services/authService', () => ({
  setAuthCookie: vi.fn(),
  clearAuthCookie: vi.fn(),
  getAuthCookieName: vi.fn(),
  revokeAuthSession: vi.fn(),
  revokeAllAuthSessionsForRole: vi.fn(),
}));
vi.mock('../../services/securityAuditService', () => ({
  recordSecurityAuditEvent: vi.fn(),
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
    (authService.getAuthCookieName as any).mockReturnValue('mytube_auth_session');
  });

  describe('getPasswordEnabled', () => {
    it('should return result from service with authenticatedRole', async () => {
      const mockResult = { enabled: true, waitTime: undefined };
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
      expect(authService.setAuthCookie).toHaveBeenCalledWith(
        mockRes,
        'mock-token',
        'admin',
        expect.objectContaining({
          authMethod: 'password',
        })
      );
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, role: 'admin' });
    });

    it('should return 401 if incorrect', async () => {
      mockReq.body = { password: 'wrong' };
      (passwordService.verifyPassword as any).mockResolvedValue({ 
          success: false, 
          message: 'Incorrect', 
          waitTime: undefined 
      });

      await passwordController.verifyPassword(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
          success: false
      }));
    });

    it('should return 429 if rate limited', async () => {
      mockReq.body = { password: 'any' };
      (passwordService.verifyPassword as any).mockResolvedValue({ 
          success: false, 
          message: 'Wait', 
          waitTime: 60 
      });

      await passwordController.verifyPassword(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
          success: false,
          waitTime: 60
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
        'admin',
        expect.objectContaining({
          authMethod: 'password',
        })
      );
      expect(jsonMock).toHaveBeenCalledWith({ success: true, role: 'admin' });
    });

    it('should return statusCode 401 for invalid admin password', async () => {
      mockReq.body = { password: 'wrong-admin' };
      (passwordService.verifyAdminPassword as any).mockResolvedValue({
        success: false,
        message: 'invalid',
        waitTime: undefined,
        failedAttempts: 2,
      });

      await passwordController.verifyAdminPassword(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: 401,
          failedAttempts: 2,
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
        'visitor',
        expect.objectContaining({
          authMethod: 'password',
        })
      );
      expect(jsonMock).toHaveBeenCalledWith({ success: true, role: 'visitor' });
    });

    it('should return statusCode 429 when visitor verification is throttled', async () => {
      mockReq.body = { password: 'visitor-pass' };
      (passwordService.verifyVisitorPassword as any).mockResolvedValue({
        success: false,
        message: 'wait',
        waitTime: 30,
        failedAttempts: 3,
      });

      await passwordController.verifyVisitorPassword(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          waitTime: 30,
          statusCode: 429,
        })
      );
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

  describe('bootstrapAdmin', () => {
    it('should return 400 for weak password', async () => {
      mockReq.body = { password: 'short' };

      await passwordController.bootstrapAdmin(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
      expect(passwordService.bootstrapAdminPassword).not.toHaveBeenCalled();
    });

    it('should return 201 and set cookie when bootstrap succeeds', async () => {
      mockReq.body = { password: 'StrongPass123' };
      (passwordService.bootstrapAdminPassword as any).mockResolvedValue({ success: true });
      (passwordService.verifyAdminPassword as any).mockResolvedValue({
        success: true,
        token: 'admin-token',
        role: 'admin',
      });

      await passwordController.bootstrapAdmin(mockReq as Request, mockRes as Response);

      expect(passwordService.bootstrapAdminPassword).toHaveBeenCalledWith('StrongPass123');
      expect(authService.setAuthCookie).toHaveBeenCalledWith(
        mockRes,
        'admin-token',
        'admin',
        expect.objectContaining({
          authMethod: 'bootstrap',
        })
      );
      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should return 409 when bootstrap is already completed', async () => {
      mockReq.body = { password: 'StrongPass123' };
      (passwordService.bootstrapAdminPassword as any).mockResolvedValue({
        success: false,
        reason: 'ALREADY_COMPLETED',
        message: 'Bootstrap has already completed.',
      });

      await passwordController.bootstrapAdmin(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          reason: 'ALREADY_COMPLETED',
        })
      );
    });
  });

  describe('resetPassword', () => {
    it('should call service and return success for admin', async () => {
      mockReq.user = { role: 'admin' } as any;
      (passwordService.resetPassword as any).mockResolvedValue('newPass');

      await passwordController.resetPassword(mockReq as Request, mockRes as Response);

      expect(passwordService.resetPassword).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
          success: true
      }));
      // Should not return password
      expect(jsonMock.mock.calls[0][0]).not.toHaveProperty('password');
    });

    it('should return 403 for unauthenticated reset without recovery token', async () => {
      mockReq.user = undefined;
      (passwordService.resetPasswordWithRecoveryToken as any).mockResolvedValue({
        success: false,
        reason: 'MISSING_TOKEN',
        message: 'Recovery token is required.',
      });

      await passwordController.resetPassword(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          reason: 'MISSING_TOKEN',
        })
      );
    });

    it('should reset password with valid recovery token for unauthenticated request', async () => {
      mockReq = {
        ...mockReq,
        user: undefined,
        ip: '127.0.0.1',
        headers: {
          'x-mytube-recovery-token': 'recovery-token-abc',
        } as any,
      };
      (passwordService.resetPasswordWithRecoveryToken as any).mockResolvedValue({
        success: true,
      });

      await passwordController.resetPassword(mockReq as Request, mockRes as Response);

      expect(passwordService.resetPasswordWithRecoveryToken).toHaveBeenCalledWith(
        'recovery-token-abc',
        expect.stringContaining('127.0.0.1')
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should reject recovery token passed via query string', async () => {
      mockReq = {
        ...mockReq,
        user: undefined,
        query: {
          recoveryToken: 'query-token-abc',
        } as any,
      };

      await passwordController.resetPassword(mockReq as Request, mockRes as Response);

      expect(passwordService.resetPasswordWithRecoveryToken).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          reason: 'QUERY_TOKEN_NOT_ALLOWED',
        })
      );
      expect(securityAuditService.recordSecurityAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'auth.password.recovery_token.query_rejected',
        })
      );
    });
  });

  describe('createRecoveryToken', () => {
    it('should require admin auth', async () => {
      mockReq.user = undefined;

      await passwordController.createRecoveryToken(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
      expect(securityAuditService.recordSecurityAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'auth.password.recovery_token.issue.denied',
        })
      );
    });

    it('should return recovery token for admin', async () => {
      mockReq.user = { role: 'admin' } as any;
      (passwordService.issuePasswordRecoveryToken as any).mockReturnValue({
        token: 'one-time-token',
        expiresAt: 12345,
      });

      await passwordController.createRecoveryToken(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        token: 'one-time-token',
        expiresAt: 12345,
      });
      expect(securityAuditService.recordSecurityAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'auth.password.recovery_token.issued',
        })
      );
    });
  });

  describe('logout', () => {
    it('should clear auth cookie and return success message', async () => {
      await passwordController.logout(mockReq as Request, mockRes as Response);

      expect(authService.clearAuthCookie).toHaveBeenCalledWith(mockRes);
      expect(authService.revokeAuthSession).not.toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Logged out successfully',
      });
    });

    it('should revoke current session id when cookie exists', async () => {
      mockReq = {
        ...mockReq,
        cookies: {
          mytube_auth_session: 'session-abc',
        },
      };

      await passwordController.logout(mockReq as Request, mockRes as Response);

      expect(authService.revokeAuthSession).toHaveBeenCalledWith(
        'session-abc',
        'logout'
      );
      expect(authService.clearAuthCookie).toHaveBeenCalledWith(mockRes);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Logged out successfully',
      });
    });

    it('should reject all-devices logout without authenticated user', async () => {
      mockReq = {
        ...mockReq,
        body: { allDevices: true },
        user: undefined,
      };

      await passwordController.logout(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
      expect(authService.revokeAllAuthSessionsForRole).not.toHaveBeenCalled();
    });

    it('should revoke all sessions for authenticated user role', async () => {
      mockReq = {
        ...mockReq,
        body: { allDevices: true },
        user: { role: 'admin' } as any,
      };
      (authService.revokeAllAuthSessionsForRole as any).mockReturnValue(3);

      await passwordController.logout(mockReq as Request, mockRes as Response);

      expect(authService.revokeAllAuthSessionsForRole).toHaveBeenCalledWith(
        'admin',
        'logout_all_devices'
      );
      expect(authService.clearAuthCookie).toHaveBeenCalledWith(mockRes);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Logged out from all devices successfully',
        revokedSessions: 3,
      });
    });
  });
});
