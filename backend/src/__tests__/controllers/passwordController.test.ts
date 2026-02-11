import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as passwordController from '../../controllers/passwordController';
import * as passwordService from '../../services/passwordService';

// Mock dependencies
vi.mock('../../services/passwordService');
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

  describe('resetPassword', () => {
    it('should call service and return success', async () => {
      (passwordService.resetPassword as any).mockResolvedValue('newPass');

      await passwordController.resetPassword(mockReq as Request, mockRes as Response);

      expect(passwordService.resetPassword).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
          success: true
      }));
      // Should not return password
      expect(jsonMock.mock.calls[0][0]).not.toHaveProperty('password');
    });
  });
});
