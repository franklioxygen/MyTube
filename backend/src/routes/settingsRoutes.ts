import express from "express";
import multer from "multer";
import os from "os";
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
    deleteHook,
    getHookStatus,
    uploadHook,
} from "../controllers/hookController";
import {
    getPasswordEnabled
} from "../controllers/passwordController";
import {
    deleteLegacyData,
    formatFilenames,
    getCloudflaredStatus,
    getSettings,
    migrateData,
    updateSettings,
} from "../controllers/settingsController";
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

// ... existing imports ...

// Cookie routes
router.post(
  "/upload-cookies",
  upload.single("file"),
  asyncHandler(uploadCookies)
);
router.post("/delete-cookies", asyncHandler(deleteCookies));
router.get("/check-cookies", asyncHandler(checkCookies));

// Hook routes
router.post(
  "/hooks/:name",
  upload.single("file"),
  asyncHandler(uploadHook)
);
router.delete("/hooks/:name", asyncHandler(deleteHook));
router.get("/hooks/status", asyncHandler(getHookStatus));

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
