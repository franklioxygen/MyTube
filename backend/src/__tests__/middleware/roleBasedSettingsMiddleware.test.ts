import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { roleBasedSettingsMiddleware } from '../../middleware/roleBasedSettingsMiddleware';

describe('roleBasedSettingsMiddleware Security', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = {
        method: 'GET',
        user: { role: 'visitor' } as any
    };
    res = {
      json,
      status,
    };
    next = vi.fn();
  });

  it('should BLOCK visitor access to export-database', () => {
    req = {
      method: "GET",
      path: "/export-database",
      url: "/export-database",
      user: { role: "visitor" } as any,
    };
    
    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringContaining('Access to this resource is restricted')
    }));
  });

  it('should ALLOW visitor access to allowed paths', () => {
      req = {
        method: "GET",
        path: "/password-enabled",
        url: "/password-enabled",
        user: { role: "visitor" } as any,
      };

      roleBasedSettingsMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
  });

  it('should ALLOW visitor access to root path', () => {
      req = {
        method: "GET",
        path: "/",
        url: "/",
        user: { role: "visitor" } as any,
      };

      roleBasedSettingsMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
  });

  it('should ALLOW admin access to export-database', () => {
    req = {
      method: "GET",
      path: "/export-database",
      url: "/export-database",
      user: { role: "admin" } as any,
    };

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });
});
