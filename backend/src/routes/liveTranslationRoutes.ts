import express from "express";
import { asyncHandler } from "../middleware/errorHandler";
import {
  createSession,
  getConfig,
} from "../controllers/liveTranslationController";

const router = express.Router();

// GET /api/live-translation/config — secret-free availability snapshot.
router.get("/config", asyncHandler(getConfig));

// POST /api/live-translation/sessions — mint a one-use WebSocket ticket.
router.post("/sessions", asyncHandler(createSession));

export default router;
