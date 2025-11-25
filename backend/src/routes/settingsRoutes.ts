import express from 'express';
import { deleteLegacyData, getSettings, migrateData, updateSettings, verifyPassword } from '../controllers/settingsController';

const router = express.Router();

router.get('/', getSettings);
router.post('/', updateSettings);
router.post('/verify-password', verifyPassword);
router.post('/migrate', migrateData);
router.post('/delete-legacy', deleteLegacyData);

export default router;
