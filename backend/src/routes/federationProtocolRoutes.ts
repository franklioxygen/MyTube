import express from "express";
import {
  deleteSnapshot,
  getCapabilities,
  getLibraryRevision,
  getSnapshotPage,
  getVideoAsset,
  getVideoDetail,
  postSnapshot,
} from "../controllers/federationProtocolController";
import {
  federationAuthentication,
  federationNoStore,
  requireFederationScope,
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

const libraryRead = requireFederationScope("library:read");
router.get("/library/revision", libraryRead, getLibraryRevision);
router.post("/snapshots", libraryRead, postSnapshot);
router.get("/snapshots/:snapshotId/videos", libraryRead, getSnapshotPage);
router.delete("/snapshots/:snapshotId", libraryRead, deleteSnapshot);
router.get("/videos/:nativeId", libraryRead, getVideoDetail);

// GET routes also answer HEAD.
router.get("/videos/:nativeId/assets/:kind", requireFederationScope("media:read"), getVideoAsset);

router.use((_req, res) => {
  res.status(404).json({
    success: false,
    code: "FEDERATION_NOT_FOUND",
    error: "Unknown federation endpoint.",
  });
});

export default router;
