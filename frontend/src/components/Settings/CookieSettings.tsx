import { CloudUpload } from '@mui/icons-material';
import { Box, Button, Typography } from '@mui/material';
import axios from 'axios';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

const API_URL = import.meta.env.VITE_API_URL;

interface CookieSettingsProps {
    onSuccess: (message: string) => void;
    onError: (message: string) => void;
}

const CookieSettings: React.FC<CookieSettingsProps> = ({ onSuccess, onError }) => {
    const { t } = useLanguage();

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.name.endsWith('.txt')) {
            onError(t('onlyTxtFilesAllowed') || 'Only .txt files are allowed');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            await axios.post(`${API_URL}/settings/upload-cookies`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            onSuccess(t('cookiesUploadedSuccess') || 'Cookies uploaded successfully');
        } catch (error) {
            console.error('Error uploading cookies:', error);
            onError(t('cookiesUploadFailed') || 'Failed to upload cookies');
        }

        // Reset input
        e.target.value = '';
    };

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('cookieSettings') || 'Cookie Settings'}</Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
                {t('cookieUploadDescription') || 'Upload cookies.txt to pass YouTube bot checks and enable Bilibili subtitle downloads. The file will be renamed to cookies.txt automatically. (Example: use "Get cookies.txt LOCALLY" extension to export cookies)'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <Button
                    variant="outlined"
                    component="label"
                    startIcon={<CloudUpload />}
                >
                    {t('uploadCookies') || 'Upload Cookies'}
                    <input
                        type="file"
                        hidden
                        accept=".txt"
                        onChange={handleFileUpload}
                    />
                </Button>
            </Box>
        </Box>
    );
};

export default CookieSettings;
