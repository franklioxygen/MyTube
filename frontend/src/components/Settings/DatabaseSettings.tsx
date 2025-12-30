import { Close, Delete, Download, History, Upload } from '@mui/icons-material';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControlLabel,
    IconButton,
    Switch,
    Typography
} from '@mui/material';
import React, { useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface DatabaseSettingsProps {
    onMigrate: () => void;
    onDeleteLegacy: () => void;
    onFormatFilenames: () => void;
    onExportDatabase: () => void;
    onImportDatabase: (file: File) => void;
    onCleanupBackupDatabases: () => void;
    onRestoreFromLastBackup: () => void;
    isSaving: boolean;
    lastBackupInfo?: { exists: boolean; filename?: string; timestamp?: string } | null;
    moveSubtitlesToVideoFolder: boolean;
    onMoveSubtitlesToVideoFolderChange: (checked: boolean) => void;
    moveThumbnailsToVideoFolder: boolean;
    onMoveThumbnailsToVideoFolderChange: (checked: boolean) => void;
}

const DatabaseSettings: React.FC<DatabaseSettingsProps> = ({
    onMigrate,
    onDeleteLegacy,
    onFormatFilenames,
    onExportDatabase,
    onImportDatabase,
    onCleanupBackupDatabases,
    onRestoreFromLastBackup,
    isSaving,
    lastBackupInfo,
    moveSubtitlesToVideoFolder,
    onMoveSubtitlesToVideoFolderChange,
    moveThumbnailsToVideoFolder,
    onMoveThumbnailsToVideoFolderChange
}) => {
    const { t } = useLanguage();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
    const [restoreModalOpen, setRestoreModalOpen] = useState(false);

    const handleOpenImportModal = () => {
        setImportModalOpen(true);
    };

    const handleCloseImportModal = () => {
        setImportModalOpen(false);
        setSelectedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.name.endsWith('.db')) {
                alert(t('onlyDbFilesAllowed') || 'Only .db files are allowed');
                return;
            }
            setSelectedFile(file);
        }
    };

    const handleConfirmImport = () => {
        if (selectedFile) {
            onImportDatabase(selectedFile);
            handleCloseImportModal();
        }
    };

    const handleOpenCleanupModal = () => {
        setCleanupModalOpen(true);
    };

    const handleCloseCleanupModal = () => {
        setCleanupModalOpen(false);
    };

    const handleConfirmCleanup = () => {
        onCleanupBackupDatabases();
        handleCloseCleanupModal();
    };

    const handleOpenRestoreModal = () => {
        setRestoreModalOpen(true);
    };

    const handleCloseRestoreModal = () => {
        setRestoreModalOpen(false);
    };

    const handleConfirmRestore = () => {
        onRestoreFromLastBackup();
        handleCloseRestoreModal();
    };

    const formatBackupTimestamp = (timestamp: string): string => {
        // Parse timestamp format: YYYY-MM-DD-HH-MM-SS
        const parts = timestamp.split('-');
        if (parts.length === 6) {
            const [year, month, day, hour, minute, second] = parts;
            const date = new Date(
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second)
            );
            return date.toLocaleString();
        }
        return timestamp;
    };

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('database') || 'Database'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('migrateDataDescription')}
            </Typography>
            <Button
                variant="outlined"
                color="warning"
                onClick={onMigrate}
                disabled={isSaving}
            >
                {t('migrateDataButton')}
            </Button>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('formatLegacyFilenames')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('formatLegacyFilenamesDescription')}
                </Typography>
                <Button
                    variant="outlined"
                    color="primary"
                    onClick={onFormatFilenames}
                    disabled={isSaving}
                >
                    {t('formatLegacyFilenamesButton')}
                </Button>
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('removeLegacyData')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('removeLegacyDataDescription')}
                </Typography>
                <Button
                    variant="outlined"
                    color="error"
                    onClick={onDeleteLegacy}
                    disabled={isSaving}
                >
                    {t('deleteLegacyDataButton')}
                </Button>
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('moveSubtitlesToVideoFolder')}</Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={moveSubtitlesToVideoFolder}
                            onChange={(e) => onMoveSubtitlesToVideoFolderChange(e.target.checked)}
                            disabled={isSaving}
                        />
                    }
                    label={moveSubtitlesToVideoFolder ? t('moveSubtitlesToVideoFolderOn') : t('moveSubtitlesToVideoFolderOff')}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('moveSubtitlesToVideoFolderDescription')}
                </Typography>
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('moveThumbnailsToVideoFolder')}</Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={moveThumbnailsToVideoFolder}
                            onChange={(e) => onMoveThumbnailsToVideoFolderChange(e.target.checked)}
                            disabled={isSaving}
                        />
                    }
                    label={moveThumbnailsToVideoFolder ? t('moveThumbnailsToVideoFolderOn') : t('moveThumbnailsToVideoFolderOff')}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('moveThumbnailsToVideoFolderDescription')}
                </Typography>
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('exportImportDatabase')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('exportImportDatabaseDescription')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <Button
                        variant="outlined"
                        color="primary"
                        startIcon={<Download />}
                        onClick={onExportDatabase}
                        disabled={isSaving}
                    >
                        {t('exportDatabase')}
                    </Button>
                    <Button
                        variant="outlined"
                        color="primary"
                        startIcon={<Upload />}
                        onClick={handleOpenImportModal}
                        disabled={isSaving}
                    >
                        {t('importDatabase')}
                    </Button>
                    {lastBackupInfo?.exists && (
                        <Button
                            variant="outlined"
                            color="warning"
                            startIcon={<History />}
                            onClick={handleOpenRestoreModal}
                            disabled={isSaving}
                        >
                            {t('restoreFromLastBackup')}
                        </Button>
                    )}
                    <Button
                        variant="outlined"
                        color="warning"
                        startIcon={<Delete />}
                        onClick={handleOpenCleanupModal}
                        disabled={isSaving}
                    >
                        {t('cleanupBackupDatabases')}
                    </Button>
                </Box>
            </Box>

            <Dialog
                open={importModalOpen}
                onClose={handleCloseImportModal}
                maxWidth="sm"
                fullWidth
                slotProps={{
                    paper: {
                        sx: { borderRadius: 2 }
                    }
                }}
            >
                <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                        {t('importDatabase')}
                    </Typography>
                    <IconButton
                        aria-label="close"
                        onClick={handleCloseImportModal}
                        sx={{
                            color: (theme) => theme.palette.grey[500],
                        }}
                    >
                        <Close />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    <DialogContentText sx={{ mb: 2, color: 'text.primary' }}>
                        {t('importDatabaseWarning')}
                    </DialogContentText>
                    <Button
                        variant="outlined"
                        component="label"
                        startIcon={<Upload />}
                        fullWidth
                        sx={{ borderStyle: 'dashed', height: 56 }}
                    >
                        {selectedFile ? selectedFile.name : t('selectDatabaseFile')}
                        <input
                            ref={fileInputRef}
                            type="file"
                            hidden
                            accept=".db"
                            onChange={handleFileSelect}
                        />
                    </Button>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={handleCloseImportModal} disabled={isSaving}>
                        {t('cancel')}
                    </Button>
                    <Button
                        onClick={handleConfirmImport}
                        variant="contained"
                        color="primary"
                        disabled={!selectedFile || isSaving}
                    >
                        {t('importDatabase')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={cleanupModalOpen}
                onClose={handleCloseCleanupModal}
                maxWidth="sm"
                fullWidth
                slotProps={{
                    paper: {
                        sx: { borderRadius: 2 }
                    }
                }}
            >
                <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                        {t('cleanupBackupDatabases')}
                    </Typography>
                    <IconButton
                        aria-label="close"
                        onClick={handleCloseCleanupModal}
                        sx={{
                            color: (theme) => theme.palette.grey[500],
                        }}
                    >
                        <Close />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    <DialogContentText sx={{ mb: 2, color: 'text.primary' }}>
                        {t('cleanupBackupDatabasesWarning')}
                    </DialogContentText>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={handleCloseCleanupModal} disabled={isSaving}>
                        {t('cancel')}
                    </Button>
                    <Button
                        onClick={handleConfirmCleanup}
                        variant="contained"
                        color="warning"
                        disabled={isSaving}
                    >
                        {t('cleanupBackupDatabases')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={restoreModalOpen}
                onClose={handleCloseRestoreModal}
                maxWidth="sm"
                fullWidth
                slotProps={{
                    paper: {
                        sx: { borderRadius: 2 }
                    }
                }}
            >
                <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                        {t('restoreFromLastBackup')}
                    </Typography>
                    <IconButton
                        aria-label="close"
                        onClick={handleCloseRestoreModal}
                        sx={{
                            color: (theme) => theme.palette.grey[500],
                        }}
                    >
                        <Close />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    <DialogContentText sx={{ mb: 2, color: 'text.primary' }}>
                        {t('restoreFromLastBackupWarning')}
                    </DialogContentText>
                    {lastBackupInfo?.timestamp && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                            <strong>{t('lastBackupDate')}:</strong> {formatBackupTimestamp(lastBackupInfo.timestamp)}
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={handleCloseRestoreModal} disabled={isSaving}>
                        {t('cancel')}
                    </Button>
                    <Button
                        onClick={handleConfirmRestore}
                        variant="contained"
                        color="secondary"
                        disabled={isSaving}
                    >
                        {t('restoreFromLastBackup')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default DatabaseSettings;
