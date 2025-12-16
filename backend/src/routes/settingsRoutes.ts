import express from "express";
import multer from "multer";
import os from "os";
import {
  checkCookies,
  deleteCookies,
  deleteLegacyData,
  formatFilenames,
  getPasswordEnabled,
  getSettings,
  migrateData,
  resetPassword,
  updateSettings,
  uploadCookies,
  verifyPassword,
} from "../controllers/settingsController";
import { asyncHandler } from "../middleware/errorHandler";

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });

router.get("/", asyncHandler(getSettings));
router.post("/", asyncHandler(updateSettings));
router.get("/password-enabled", asyncHandler(getPasswordEnabled));
router.post("/verify-password", asyncHandler(verifyPassword));
router.post("/reset-password", asyncHandler(resetPassword));
router.post("/migrate", asyncHandler(migrateData));
router.post("/delete-legacy", asyncHandler(deleteLegacyData));
router.post("/format-filenames", asyncHandler(formatFilenames));
router.post(
  "/upload-cookies",
  upload.single("file"),
  asyncHandler(uploadCookies)
);
router.post("/delete-cookies", asyncHandler(deleteCookies));
router.get("/check-cookies", asyncHandler(checkCookies));

export default router;
