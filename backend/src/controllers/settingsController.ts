import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import fs from 'fs-extra';
import path from 'path';
import { COLLECTIONS_DATA_PATH, STATUS_DATA_PATH, VIDEOS_DATA_PATH } from '../config/paths';
import downloadManager from '../services/downloadManager';
import * as storageService from '../services/storageService';

interface Settings {
    loginEnabled: boolean;
    password?: string;
    defaultAutoPlay: boolean;
    defaultAutoLoop: boolean;
    maxConcurrentDownloads: number;
    language: string;
    tags?: string[];
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
        const settings = storageService.getSettings();
        
        // If empty (first run), save defaults
        if (Object.keys(settings).length === 0) {
            storageService.saveSettings(defaultSettings);
            return res.json(defaultSettings);
        }

        // Merge with defaults to ensure all fields exist
        const mergedSettings = { ...defaultSettings, ...settings };

        // Do not send the hashed password to the frontend
        const { password, ...safeSettings } = mergedSettings;
        res.json({ ...safeSettings, isPasswordSet: !!password });
    } catch (error) {
        console.error('Error reading settings:', error);
        res.status(500).json({ error: 'Failed to read settings' });
    }
};

export const migrateData = async (req: Request, res: Response) => {
    try {
        const { runMigration } = await import('../services/migrationService');
        const results = await runMigration();
        res.json({ success: true, results });
    } catch (error: any) {
        console.error('Error running migration:', error);
        res.status(500).json({ error: 'Failed to run migration', details: error.message });
    }
};

export const deleteLegacyData = async (req: Request, res: Response) => {
    try {
        const SETTINGS_DATA_PATH = path.join(path.dirname(VIDEOS_DATA_PATH), 'settings.json');
        const filesToDelete = [
            VIDEOS_DATA_PATH,
            COLLECTIONS_DATA_PATH,
            STATUS_DATA_PATH,
            SETTINGS_DATA_PATH
        ];

        const results: { deleted: string[], failed: string[] } = {
            deleted: [],
            failed: []
        };

        for (const file of filesToDelete) {
            if (fs.existsSync(file)) {
                try {
                    fs.unlinkSync(file);
                    results.deleted.push(path.basename(file));
                } catch (err) {
                    console.error(`Failed to delete ${file}:`, err);
                    results.failed.push(path.basename(file));
                }
            }
        }

        res.json({ success: true, results });
    } catch (error: any) {
        console.error('Error deleting legacy data:', error);
        res.status(500).json({ error: 'Failed to delete legacy data', details: error.message });
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
            // If password is empty/not provided, keep existing password
            const existingSettings = storageService.getSettings();
            newSettings.password = existingSettings.password;
        }

        // Check for deleted tags and remove them from all videos
        const existingSettings = storageService.getSettings();
        const oldTags: string[] = existingSettings.tags || [];
        const newTagsList: string[] = newSettings.tags || [];
        
        const deletedTags = oldTags.filter(tag => !newTagsList.includes(tag));
        
        if (deletedTags.length > 0) {
            console.log('Tags deleted:', deletedTags);
            const allVideos = storageService.getVideos();
            let videosUpdatedCount = 0;
            
            for (const video of allVideos) {
                if (video.tags && video.tags.some(tag => deletedTags.includes(tag))) {
                    const updatedTags = video.tags.filter(tag => !deletedTags.includes(tag));
                    storageService.updateVideo(video.id, { tags: updatedTags });
                    videosUpdatedCount++;
                }
            }
            console.log(`Removed deleted tags from ${videosUpdatedCount} videos`);
        }

        storageService.saveSettings(newSettings);

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
        
        const settings = storageService.getSettings();
        const mergedSettings = { ...defaultSettings, ...settings };
        
        if (!mergedSettings.loginEnabled) {
            return res.json({ success: true });
        }

        if (!mergedSettings.password) {
            // If no password set but login enabled, allow access
            return res.json({ success: true });
        }

        const isMatch = await bcrypt.compare(password, mergedSettings.password);

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
