import express from "express";
import multer from "multer";
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
    checkPasskeysExist,
    generateAuthenticationOptions,
    generateRegistrationOptions,
    getPasskeys,
    removeAllPasskeys,
    verifyAuthentication,
    verifyRegistration,
} from "../controllers/passkeyController";
import {
    getPasswordEnabled,
    getResetPasswordCooldown,
    logout,
    resetPassword,
    verifyAdminPassword,
    verifyPassword,
    verifyVisitorPassword,
} from "../controllers/passwordController";
import {
    deleteLegacyData,
    formatFilenames,
    getCloudflaredStatus,
    getSettings,
    migrateData,
    patchSettings,
    renameTag,
    testTelegramNotification,
} from "../controllers/settingsController";
import { asyncHandler } from "../middleware/errorHandler";

const router = express.Router();
const uploadInMemory = multer({ storage: multer.memoryStorage() });
const uploadCookieFile = uploadInMemory.single("file");
const uploadHookFile = uploadInMemory.single("file");
const uploadDatabaseFile = uploadInMemory.single("file");

router.get("/", asyncHandler(getSettings));
router.patch("/", asyncHandler(patchSettings));
router.post("/migrate", asyncHandler(migrateData));
router.post("/delete-legacy", asyncHandler(deleteLegacyData));
router.post("/format-filenames", asyncHandler(formatFilenames));
router.get("/cloudflared/status", asyncHandler(getCloudflaredStatus));
router.post("/tags/rename", asyncHandler(renameTag));

// Password routes
router.get("/password-enabled", asyncHandler(getPasswordEnabled));
router.get("/reset-password-cooldown", asyncHandler(getResetPasswordCooldown));
router.post("/verify-password", asyncHandler(verifyPassword)); // Deprecated, use verify-admin-password or verify-visitor-password
router.post("/verify-admin-password", asyncHandler(verifyAdminPassword));
router.post("/verify-visitor-password", asyncHandler(verifyVisitorPassword));
router.post("/reset-password", asyncHandler(resetPassword));
router.post("/logout", asyncHandler(logout));

// Passkey routes
router.get("/passkeys", asyncHandler(getPasskeys));
router.get("/passkeys/exists", asyncHandler(checkPasskeysExist));
router.post("/passkeys/register", asyncHandler(generateRegistrationOptions));
router.post("/passkeys/register/verify", asyncHandler(verifyRegistration));
router.post("/passkeys/authenticate", asyncHandler(generateAuthenticationOptions));
router.post("/passkeys/authenticate/verify", asyncHandler(verifyAuthentication));
router.delete("/passkeys", asyncHandler(removeAllPasskeys));

// ... existing imports ...

// Cookie routes
router.post(
  "/upload-cookies",
  uploadCookieFile,
  asyncHandler(uploadCookies)
);
router.post("/delete-cookies", asyncHandler(deleteCookies));
router.get("/check-cookies", asyncHandler(checkCookies));

// Telegram routes
router.post("/telegram/test", asyncHandler(testTelegramNotification));

// Hook routes
router.post("/hooks/:name", uploadHookFile, asyncHandler(uploadHook));
router.delete("/hooks/:name", asyncHandler(deleteHook));
router.get("/hooks/status", asyncHandler(getHookStatus));

// Database backup routes
router.get("/export-database", asyncHandler(exportDatabase));
router.post(
  "/import-database",
  uploadDatabaseFile,
  asyncHandler(importDatabase)
);
router.post("/cleanup-backup-databases", asyncHandler(cleanupBackupDatabases));
router.get("/last-backup-info", asyncHandler(getLastBackupInfo));
router.post("/restore-from-last-backup", asyncHandler(restoreFromLastBackup));

export default router;
