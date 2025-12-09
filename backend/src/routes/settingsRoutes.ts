import express from 'express';
import multer from 'multer';
import os from 'os';
import { checkCookies, deleteCookies, deleteLegacyData, formatFilenames, getPasswordEnabled, getSettings, migrateData, updateSettings, uploadCookies, verifyPassword } from '../controllers/settingsController';

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });

router.get('/', getSettings);
router.post('/', updateSettings);
router.get('/password-enabled', getPasswordEnabled);
router.post('/verify-password', verifyPassword);
router.post('/migrate', migrateData);
router.post('/delete-legacy', deleteLegacyData);
router.post('/format-filenames', formatFilenames);
router.post('/upload-cookies', upload.single('file'), uploadCookies);
router.post('/delete-cookies', deleteCookies);
router.get('/check-cookies', checkCookies);

export default router;
