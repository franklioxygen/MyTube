import express from 'express';
import multer from 'multer';
import os from 'os';
import { deleteLegacyData, getSettings, migrateData, updateSettings, uploadCookies, verifyPassword } from '../controllers/settingsController';

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });

router.get('/', getSettings);
router.post('/', updateSettings);
router.post('/verify-password', verifyPassword);
router.post('/migrate', migrateData);
router.post('/delete-legacy', deleteLegacyData);
router.post('/upload-cookies', upload.single('file'), uploadCookies);

export default router;
