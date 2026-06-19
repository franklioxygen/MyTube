import { Request, Response } from "express";
import { isLoginRequired } from "../services/passwordService";
import {
  getLiveTranslationPublicConfig,
  getLiveTranslationServerConfig,
} from "../services/liveTranslation/config";
import {
  createTicket,
  DEFAULT_TICKET_TTL_MS,
  startTicketSweeper,
} from "../services/liveTranslation/sessionTickets";
import { errorResponse } from "../utils/response";

export const LIVE_TRANSLATION_WS_PATH = "/api/live-translation/ws";

interface RequesterContext {
  isAdmin: boolean;
  loginRequired: boolean;
}

function resolveRequester(req: Request): RequesterContext {
  return {
    isAdmin: req.user?.role === "admin",
    loginRequired: isLoginRequired(),
  };
}

/**
 * GET /api/live-translation/config — secret-free availability snapshot the
 * player uses to decide whether to show the Live Translate button.
 */
export const getConfig = async (req: Request, res: Response): Promise<void> => {
  // Defense in depth: API-key clients must never use live translation, even
  // though roleBasedAuthMiddleware already blocks them.
  if (req.apiKeyAuthenticated === true) {
    res.status(403).json(
      errorResponse("Live translation is not available for API key clients.", {
        reason: "admin_required",
      })
    );
    return;
  }

  const config = getLiveTranslationPublicConfig(resolveRequester(req));
  res.json(config);
};

/**
 * POST /api/live-translation/sessions — mint a one-use, short-lived ticket the
 * browser exchanges for a WebSocket upgrade. CSRF + session auth are enforced by
 * upstream middleware; this also enforces the MVP admin-only / no-API-key rules.
 */
export const createSession = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (req.apiKeyAuthenticated === true) {
    res.status(403).json(
      errorResponse("Live translation is not available for API key clients.", {
        reason: "admin_required",
      })
    );
    return;
  }

  const requester = resolveRequester(req);

  // MVP: require an admin session whenever login is enabled (avoid surprise spend).
  if (requester.loginRequired && !requester.isAdmin) {
    res.status(403).json(
      errorResponse("Admin access is required for live translation.", {
        reason: "admin_required",
      })
    );
    return;
  }

  const serverConfig = getLiveTranslationServerConfig();
  const publicConfig = getLiveTranslationPublicConfig(requester);

  if (!publicConfig.available) {
    res.status(400).json(
      errorResponse("Live translation is not available.", {
        reason: publicConfig.reason ?? "invalid_settings",
      })
    );
    return;
  }

  const videoId =
    typeof req.body?.videoId === "string" ? req.body.videoId.trim() : "";
  if (!videoId) {
    res
      .status(400)
      .json(errorResponse("videoId is required.", { reason: "invalid_settings" }));
    return;
  }

  startTicketSweeper();

  // MVP only mints admin-equivalent tickets: when login is enabled only admins
  // reach here; when login is disabled the deployment grants full access.
  const ticket = createTicket({
    role: "admin",
    videoId,
    config: serverConfig,
  });

  res.json({
    ticket: ticket.ticket,
    expiresAt: ticket.expiresAt,
    ttlMs: DEFAULT_TICKET_TTL_MS,
    wsPath: LIVE_TRANSLATION_WS_PATH,
    config: {
      model: serverConfig.model,
      sourceLanguage: serverConfig.sourceLanguage,
      targetLanguage: serverConfig.targetLanguage,
    },
  });
};
