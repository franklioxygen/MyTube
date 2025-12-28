import express from "express";
import multer from "multer";
import os from "os";
import {
  deleteLegacyData,
  formatFilenames,
  getCloudflaredStatus,
  getSettings,
  migrateData,
  updateSettings,
} from "../controllers/settingsController";
import {
  checkCookies,
  deleteCookies,
  uploadCookies,
} from "../controllers/cookieController";
import {
  cleanupBackupDatabases,
  exportDatabase,
  getLastBackupInfo,
  importDatabase,
  restoreFromLastBackup,
} from "../controllers/databaseBackupController";
import {
  getPasswordEnabled,
  resetPassword,
  verifyPassword,
} from "../controllers/passwordController";
import { asyncHandler } from "../middleware/errorHandler";

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });

router.get("/", asyncHandler(getSettings));
router.post("/", asyncHandler(updateSettings));
router.post("/migrate", asyncHandler(migrateData));
router.post("/delete-legacy", asyncHandler(deleteLegacyData));
router.post("/format-filenames", asyncHandler(formatFilenames));
router.get("/cloudflared/status", asyncHandler(getCloudflaredStatus));

// Password routes
router.get("/password-enabled", asyncHandler(getPasswordEnabled));
router.post("/verify-password", asyncHandler(verifyPassword));
router.post("/reset-password", asyncHandler(resetPassword));

// Cookie routes
router.post(
  "/upload-cookies",
  upload.single("file"),
  asyncHandler(uploadCookies)
);
router.post("/delete-cookies", asyncHandler(deleteCookies));
router.get("/check-cookies", asyncHandler(checkCookies));

// Database backup routes
router.get("/export-database", asyncHandler(exportDatabase));
router.post(
  "/import-database",
  upload.single("file"),
  asyncHandler(importDatabase)
);
router.post("/cleanup-backup-databases", asyncHandler(cleanupBackupDatabases));
router.get("/last-backup-info", asyncHandler(getLastBackupInfo));
router.post("/restore-from-last-backup", asyncHandler(restoreFromLastBackup));

export default router;
