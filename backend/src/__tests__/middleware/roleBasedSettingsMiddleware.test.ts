import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isStrictSecurityModel } from '../../config/securityModel';
import { roleBasedSettingsMiddleware } from '../../middleware/roleBasedSettingsMiddleware';
import { isLoginRequired } from '../../services/passwordService';

vi.mock('../../services/passwordService', () => ({
  isLoginRequired: vi.fn(),
}));
vi.mock('../../config/securityModel', () => ({
  isStrictSecurityModel: vi.fn(),
}));
vi.mock('../../services/securityAuditService', () => ({
  recordSecurityAuditEvent: vi.fn(),
}));

describe('roleBasedSettingsMiddleware Security', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isStrictSecurityModel).mockReturnValue(false);
    vi.mocked(isLoginRequired).mockReturnValue(true);
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

  it('should BLOCK api-key-authenticated access to settings routes', () => {
    req = {
      method: "GET",
      path: "/",
      url: "/",
      apiKeyAuthenticated: true,
    };

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.stringContaining('cannot access settings'),
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

  it('should ALLOW visitor access to allowed sub-paths', () => {
    req = {
      method: 'GET',
      path: '/cloudflared/status/live',
      url: '/cloudflared/status/live',
      user: { role: 'visitor' } as any,
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

  it('should ALLOW visitor PATCH for cloudflare-only update', () => {
    req = {
      method: "PATCH",
      path: "/",
      url: "/",
      body: { cloudflaredTunnelEnabled: true, cloudflaredToken: "token" },
      user: { role: "visitor" } as any,
    };

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('should ALLOW visitor POST verify password endpoints', () => {
    req = {
      method: 'POST',
      path: '/verify-admin-password',
      url: '/verify-admin-password',
      body: {},
      user: { role: 'visitor' } as any,
    };

    roleBasedSettingsMiddleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('should ALLOW visitor POST passkey authentication and logout', () => {
    req = {
      method: 'POST',
      path: '/passkeys/authenticate',
      url: '/passkeys/authenticate',
      body: {},
      user: { role: 'visitor' } as any,
    };
    roleBasedSettingsMiddleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    req = {
      method: 'POST',
      path: '/logout',
      url: '/logout',
      body: {},
      user: { role: 'visitor' } as any,
    };
    roleBasedSettingsMiddleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('should BLOCK visitor cloudflare update when body contains extra keys', () => {
    req = {
      method: 'PATCH',
      path: '/',
      url: '/',
      body: {
        cloudflaredTunnelEnabled: true,
        cloudflaredToken: 'token',
        theme: 'dark',
      },
      user: { role: 'visitor' } as any,
    };

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('should BLOCK visitor non-GET/POST/PATCH methods', () => {
    req = {
      method: 'DELETE',
      path: '/',
      url: '/',
      user: { role: 'visitor' } as any,
    };

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Visitor role: Write operations are not allowed.',
      })
    );
  });

  it('should BLOCK unauthenticated non-public routes when login is required', () => {
    req = {
      method: 'GET',
      path: '/private-settings',
      url: '/private-settings',
      user: undefined,
    };
    vi.mocked(isLoginRequired).mockReturnValue(true);

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
      })
    );
  });

  it('should ALLOW unauthenticated access to public endpoints when login is required', () => {
    req = {
      method: 'GET',
      path: '/password-enabled',
      url: '/password-enabled',
      user: undefined,
    };
    vi.mocked(isLoginRequired).mockReturnValue(true);

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('should ALLOW unauthenticated routes when login is not required', () => {
    req = {
      method: 'GET',
      path: '/anything',
      url: '/anything',
      user: undefined,
    };
    vi.mocked(isStrictSecurityModel).mockReturnValue(false);
    vi.mocked(isLoginRequired).mockReturnValue(false);

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('should BLOCK unauthenticated write routes in legacy mode when login is not required', () => {
    req = {
      method: 'POST',
      path: '/tags/rename',
      url: '/tags/rename',
      user: undefined,
    };
    vi.mocked(isStrictSecurityModel).mockReturnValue(false);
    vi.mocked(isLoginRequired).mockReturnValue(false);

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
      })
    );
  });

  it('should BLOCK unauthenticated write routes in strict mode even when login is not required', () => {
    req = {
      method: 'POST',
      path: '/tags/rename',
      url: '/tags/rename',
      user: undefined,
    };
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    vi.mocked(isLoginRequired).mockReturnValue(false);

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
      })
    );
  });

  it('should ALLOW unauthenticated bootstrap endpoint in strict mode', () => {
    req = {
      method: 'POST',
      path: '/bootstrap',
      url: '/bootstrap',
      user: undefined,
    };
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    vi.mocked(isLoginRequired).mockReturnValue(false);

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('should ALLOW unauthenticated reset-password when recovery token is provided', () => {
    req = {
      method: 'POST',
      path: '/reset-password',
      url: '/reset-password',
      headers: {
        'x-mytube-recovery-token': 'token-123',
      } as any,
      body: {},
      user: undefined,
    };
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    vi.mocked(isLoginRequired).mockReturnValue(false);

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('should BLOCK unauthenticated reset-password without recovery token in strict mode', () => {
    req = {
      method: 'POST',
      path: '/reset-password',
      url: '/reset-password',
      user: undefined,
    };
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    vi.mocked(isLoginRequired).mockReturnValue(false);

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('should BLOCK unauthenticated passkeys/register in strict mode', () => {
    req = {
      method: 'POST',
      path: '/passkeys/register',
      url: '/passkeys/register',
      user: undefined,
    };
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    vi.mocked(isLoginRequired).mockReturnValue(false);

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('should ALLOW fallback roles that are neither admin nor visitor', () => {
    req = {
      method: 'GET',
      path: '/settings',
      url: '/settings',
      user: { role: 'other' } as any,
    };

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('should BLOCK visitor PATCH for non-cloudflare settings update', () => {
    req = {
      method: "PATCH",
      path: "/",
      url: "/",
      body: { theme: "dark" },
      user: { role: "visitor" } as any,
    };

    roleBasedSettingsMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.stringContaining('Only reading settings and updating CloudFlare settings is allowed'),
    }));
  });
});
