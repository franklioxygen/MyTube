import { NextFunction, Request, RequestHandler, Response } from "express";
import {
  authenticateFederationRequest,
  type FederationAuthFailure,
  type FederationPrincipal,
} from "../services/federation/tokenService";
import { readHeaderValue } from "../utils/apiKeyAuth";

declare global {
  namespace Express {
    interface Request {
      federationPrincipal?: FederationPrincipal;
    }
  }
}

/** Sent by a consumer on every protocol request; pinned to its token. */
export const FEDERATION_CONSUMER_HEADER = "x-mytube-instance-id";

const FAILURES: Record<
  FederationAuthFailure,
  { status: number; code: string; error: string }
> = {
  missing_credential: {
    status: 401,
    code: "FEDERATION_UNAUTHORIZED",
    error: "A federation credential is required.",
  },
  invalid_credential: {
    status: 401,
    code: "FEDERATION_UNAUTHORIZED",
    error: "The federation credential is not valid.",
  },
  token_revoked: {
    status: 401,
    code: "FEDERATION_TOKEN_REVOKED",
    error: "The federation credential has been revoked.",
  },
  token_expired: {
    status: 401,
    code: "FEDERATION_TOKEN_EXPIRED",
    error: "The federation credential has expired.",
  },
  consumer_required: {
    status: 400,
    code: "FEDERATION_CONSUMER_REQUIRED",
    error: "The consumer instance id header is missing or malformed.",
  },
  consumer_mismatch: {
    status: 403,
    code: "FEDERATION_CONSUMER_MISMATCH",
    error: "This federation credential is bound to a different instance.",
  },
  self_connection: {
    status: 409,
    code: "FEDERATION_SELF_CONNECTION",
    error: "An instance cannot federate with itself.",
  },
};

/** Federation responses carry credentials' view of a library; never cache them. */
export const federationNoStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  next();
};

/**
 * Authenticate the dedicated federation credential. There is deliberately no
 * fallback: a cookie session or a legacy API key never satisfies it, and a
 * federation principal never sets `req.apiKeyAuthenticated`.
 */
export const federationAuthentication = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = authenticateFederationRequest(
    readHeaderValue(req.headers.authorization),
    readHeaderValue(req.headers[FEDERATION_CONSUMER_HEADER])
  );

  if (!result.ok) {
    const failure = FAILURES[result.reason];
    if (failure.status === 401) {
      res.set("WWW-Authenticate", "Federation");
    }
    res
      .status(failure.status)
      .json({ success: false, code: failure.code, error: failure.error });
    return;
  }

  req.federationPrincipal = result.principal;
  next();
};
