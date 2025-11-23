import express from 'express';
import { getSettings, updateSettings, verifyPassword } from '../controllers/settingsController';

const router = express.Router();

router.get('/', getSettings);
router.post('/', updateSettings);
router.post('/verify-password', verifyPassword);

export default router;
