import { CheckCircle, CloudUpload, Delete, ErrorOutline } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import ConfirmationModal from '../ConfirmationModal';

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
            handleSuccess(t('cookiesUploadedSuccess') || 'Cookies uploaded successfully');
        } catch (error) {
            console.error('Error uploading cookies:', error);
            onError(t('cookiesUploadFailed') || 'Failed to upload cookies');
        }

    };

    const { data: cookieStatus, refetch: refetchCookieStatus, isLoading } = useQuery({
        queryKey: ['cookieStatus'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings/check-cookies`);
            return response.data;
        }
    });

    const handleSuccess = (msg: string) => {
        onSuccess(msg);
        refetchCookieStatus();
    };

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async () => {
            const response = await axios.post(`${API_URL}/settings/delete-cookies`);
            return response.data;
        },
        onSuccess: () => {
            onSuccess(t('cookiesDeletedSuccess') || 'Cookies deleted successfully');
            refetchCookieStatus();
        },
        onError: () => {
            onError(t('cookiesDeleteFailed') || 'Failed to delete cookies');
        }
    });

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleDelete = () => {
        setShowDeleteConfirm(true);
    };

    const confirmDelete = () => {
        deleteMutation.mutate();
        setShowDeleteConfirm(false);
    };

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('cookieSettings') || 'Cookie Settings'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
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

                {cookieStatus?.exists && (
                    <Box>
                        <Button
                            variant="outlined"
                            color="error"
                            startIcon={<Delete />}
                            onClick={handleDelete}
                            disabled={deleteMutation.isPending}
                        >
                            {t('deleteCookies') || 'Delete Cookies'}
                        </Button>
                    </Box>
                )}

                {isLoading ? (
                    <CircularProgress size={24} />
                ) : cookieStatus?.exists ? (
                    <Alert icon={<CheckCircle fontSize="inherit" />} severity="success">
                        {t('cookiesFound') || 'cookies.txt found'}
                    </Alert>
                ) : (
                    <Alert icon={<ErrorOutline fontSize="inherit" />} severity="warning">
                        {t('cookiesNotFound') || 'cookies.txt not found'}
                    </Alert>
                )}
            </Box>

            <ConfirmationModal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={confirmDelete}
                title={t('deleteCookies') || 'Delete Cookies'}
                message={t('confirmDeleteCookies') || 'Are you sure you want to delete the cookies file? This may affect downloading capabilities.'}
                confirmText={t('delete') || 'Delete'}
                cancelText={t('cancel') || 'Cancel'}
                isDanger={true}
            />
        </Box>
    );
};

export default CookieSettings;
