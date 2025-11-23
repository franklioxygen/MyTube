import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import fs from 'fs-extra';
import path from 'path';
import downloadManager from '../services/downloadManager';

const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');

interface Settings {
    loginEnabled: boolean;
    password?: string;
    defaultAutoPlay: boolean;
    defaultAutoLoop: boolean;
    maxConcurrentDownloads: number;
    language: string;
}

const defaultSettings: Settings = {
    loginEnabled: false,
    password: "",
    defaultAutoPlay: false,
    defaultAutoLoop: false,
    maxConcurrentDownloads: 3,
    language: 'en'
};

export const getSettings = async (req: Request, res: Response) => {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) {
            await fs.writeJson(SETTINGS_FILE, defaultSettings, { spaces: 2 });
            return res.json(defaultSettings);
        }

        const settings = await fs.readJson(SETTINGS_FILE);
        // Do not send the hashed password to the frontend
        const { password, ...safeSettings } = settings;
        res.json({ ...safeSettings, isPasswordSet: !!password });
    } catch (error) {
        console.error('Error reading settings:', error);
        res.status(500).json({ error: 'Failed to read settings' });
    }
};

export const updateSettings = async (req: Request, res: Response) => {
    try {
        const newSettings: Settings = req.body;
        
        // Validate settings if needed
        if (newSettings.maxConcurrentDownloads < 1) {
            newSettings.maxConcurrentDownloads = 1;
        }

        // Handle password hashing
        if (newSettings.password) {
            // If password is provided, hash it
            const salt = await bcrypt.genSalt(10);
            newSettings.password = await bcrypt.hash(newSettings.password, salt);
        } else {
            // If password is empty/not provided, keep existing password if file exists
            if (fs.existsSync(SETTINGS_FILE)) {
                const existingSettings = await fs.readJson(SETTINGS_FILE);
                newSettings.password = existingSettings.password;
            }
        }

        await fs.writeJson(SETTINGS_FILE, newSettings, { spaces: 2 });

        // Apply settings immediately where possible
        downloadManager.setMaxConcurrentDownloads(newSettings.maxConcurrentDownloads);

        res.json({ success: true, settings: { ...newSettings, password: undefined } });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
};

export const verifyPassword = async (req: Request, res: Response) => {
    try {
        const { password } = req.body;
        
        if (!fs.existsSync(SETTINGS_FILE)) {
            return res.json({ success: true });
        }

        const settings = await fs.readJson(SETTINGS_FILE);
        
        if (!settings.loginEnabled) {
            return res.json({ success: true });
        }

        if (!settings.password) {
            // If no password set but login enabled, allow access (or force set password?)
            // For now, allow access
            return res.json({ success: true });
        }

        const isMatch = await bcrypt.compare(password, settings.password);

        if (isMatch) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Incorrect password' });
        }
    } catch (error) {
        console.error('Error verifying password:', error);
        res.status(500).json({ error: 'Failed to verify password' });
    }
};
