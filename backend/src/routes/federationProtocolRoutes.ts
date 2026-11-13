import express from "express";
import { getCapabilities } from "../controllers/federationProtocolController";
import {
  federationAuthentication,
  federationNoStore,
} from "../middleware/federationAuthMiddleware";

/**
 * Peer side of the federation protocol, mounted at /api/federation/v1 ahead
 * of the session and API-key stack. Every request must authenticate with a
 * federation credential, and the router ends every request itself so nothing
 * falls through to legacy middleware that could admit or reinterpret it.
 */
const router = express.Router();

router.use(federationNoStore);
router.use(federationAuthentication);

router.get("/capabilities", getCapabilities);

router.use((_req, res) => {
  res.status(404).json({
    success: false,
    code: "FEDERATION_NOT_FOUND",
    error: "Unknown federation endpoint.",
  });
});

export default router;
