import { Close, Delete, Download, History, Upload } from '@mui/icons-material';
import {
    Box,
    Button,
    CircularProgress,
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
import type { MergePreviewSummary } from '../../hooks/useSettingsMutations';

interface DatabaseSettingsProps {
    onMigrate: () => void;
    onDeleteLegacy: () => void;
    onFormatFilenames: () => void;
    onExportDatabase: () => void;
    onImportDatabase: (file: File) => void;
    onPreviewMergeDatabase: (file: File) => Promise<MergePreviewSummary>;
    onMergeDatabase: (file: File) => void;
    onCleanupBackupDatabases: () => void;
    onRestoreFromLastBackup: () => void;
    isSaving: boolean;
    lastBackupInfo?: { exists: boolean; filename?: string; timestamp?: string } | null;
    moveSubtitlesToVideoFolder: boolean;
    onMoveSubtitlesToVideoFolderChange: (checked: boolean) => void;
    moveThumbnailsToVideoFolder: boolean;
    onMoveThumbnailsToVideoFolderChange: (checked: boolean) => void;
    saveAuthorFilesToCollection: boolean;
    onSaveAuthorFilesToCollectionChange: (checked: boolean) => void;
}

const DatabaseSettings: React.FC<DatabaseSettingsProps> = ({
    onMigrate,
    onDeleteLegacy,
    onFormatFilenames,
    onExportDatabase,
    onImportDatabase,
    onPreviewMergeDatabase,
    onMergeDatabase,
    onCleanupBackupDatabases,
    onRestoreFromLastBackup,
    isSaving,
    lastBackupInfo,
    moveSubtitlesToVideoFolder,
    onMoveSubtitlesToVideoFolderChange,
    moveThumbnailsToVideoFolder,
    onMoveThumbnailsToVideoFolderChange,
    saveAuthorFilesToCollection,
    onSaveAuthorFilesToCollectionChange
}) => {
    const { t } = useLanguage();
    const importFileInputRef = useRef<HTMLInputElement>(null);
    const mergeFileInputRef = useRef<HTMLInputElement>(null);
    const mergePreviewRequestIdRef = useRef(0);
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [mergeModalOpen, setMergeModalOpen] = useState(false);
    const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
    const [selectedMergeFile, setSelectedMergeFile] = useState<File | null>(null);
    const [mergePreviewSummary, setMergePreviewSummary] = useState<MergePreviewSummary | null>(null);
    const [mergePreviewError, setMergePreviewError] = useState<string | null>(null);
    const [isScanningMergePreview, setIsScanningMergePreview] = useState(false);
    const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
    const [restoreModalOpen, setRestoreModalOpen] = useState(false);

    const handleOpenImportModal = () => {
        setImportModalOpen(true);
    };

    const handleCloseImportModal = () => {
        setImportModalOpen(false);
        setSelectedImportFile(null);
        if (importFileInputRef.current) {
            importFileInputRef.current.value = '';
        }
    };

    const handleOpenMergeModal = () => {
        setMergeModalOpen(true);
    };

    const handleCloseMergeModal = () => {
        mergePreviewRequestIdRef.current += 1;
        setMergeModalOpen(false);
        setSelectedMergeFile(null);
        setMergePreviewSummary(null);
        setMergePreviewError(null);
        setIsScanningMergePreview(false);
        if (mergeFileInputRef.current) {
            mergeFileInputRef.current.value = '';
        }
    };

    const handleImportFileSelect = (
        e: React.ChangeEvent<HTMLInputElement>,
    ) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.name.endsWith('.db')) {
                setSelectedImportFile(null);
                e.target.value = '';
                alert(t('onlyDbFilesAllowed') || 'Only .db files are allowed');
                return;
            }
            setSelectedImportFile(file);
        }
    };

    const handleMergeFileSelect = async (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }

        if (!file.name.endsWith('.db')) {
            mergePreviewRequestIdRef.current += 1;
            setSelectedMergeFile(null);
            setMergePreviewSummary(null);
            setMergePreviewError(null);
            setIsScanningMergePreview(false);
            e.target.value = '';
            alert(t('onlyDbFilesAllowed') || 'Only .db files are allowed');
            return;
        }

        const requestId = ++mergePreviewRequestIdRef.current;
        setSelectedMergeFile(file);
        setMergePreviewSummary(null);
        setMergePreviewError(null);
        setIsScanningMergePreview(true);

        try {
            const summary = await onPreviewMergeDatabase(file);
            if (mergePreviewRequestIdRef.current !== requestId) {
                return;
            }
            setMergePreviewSummary(summary);
        } catch (error: any) {
            if (mergePreviewRequestIdRef.current !== requestId) {
                return;
            }
            const message =
                error?.response?.data?.details ||
                error?.response?.data?.message ||
                error?.message ||
                t('mergeDatabasePreviewErrorDefault');
            setMergePreviewError(String(message));
        } finally {
            if (mergePreviewRequestIdRef.current === requestId) {
                setIsScanningMergePreview(false);
            }
        }
    };

    const handleConfirmImport = () => {
        if (selectedImportFile) {
            onImportDatabase(selectedImportFile);
            handleCloseImportModal();
        }
    };

    const handleConfirmMerge = () => {
        if (selectedMergeFile && mergePreviewSummary && !mergePreviewError) {
            onMergeDatabase(selectedMergeFile);
            handleCloseMergeModal();
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

    const renderMergePreviewRow = (
        label: string,
        counts: { merged: number; skipped: number }
    ) => (
        <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.5 }}>
            <Typography variant="body2" color="text.primary">
                {label}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                {t('mergeDatabaseMergedCount', { count: counts.merged })} · {t('mergeDatabaseSkippedCount', { count: counts.skipped })}
            </Typography>
        </Box>
    );

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
                <Typography variant="h6" gutterBottom>{t('saveAuthorFilesToCollection')}</Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={saveAuthorFilesToCollection}
                            onChange={(e) => onSaveAuthorFilesToCollectionChange(e.target.checked)}
                            disabled={isSaving}
                        />
                    }
                    label={saveAuthorFilesToCollection ? t('saveAuthorFilesToCollectionOn') : t('saveAuthorFilesToCollectionOff')}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('saveAuthorFilesToCollectionDescription')}
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
                    <Button
                        variant="outlined"
                        color="primary"
                        startIcon={<Upload />}
                        onClick={handleOpenMergeModal}
                        disabled={isSaving}
                    >
                        {t('mergeDatabase')}
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
                        {selectedImportFile ? selectedImportFile.name : t('selectDatabaseFile')}
                        <input
                            ref={importFileInputRef}
                            type="file"
                            hidden
                            accept=".db"
                            onChange={handleImportFileSelect}
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
                        disabled={!selectedImportFile || isSaving}
                    >
                        {t('importDatabase')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={mergeModalOpen}
                onClose={handleCloseMergeModal}
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
                        {t('mergeDatabase')}
                    </Typography>
                    <IconButton
                        aria-label="close"
                        onClick={handleCloseMergeModal}
                        sx={{
                            color: (theme) => theme.palette.grey[500],
                        }}
                    >
                        <Close />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    <DialogContentText sx={{ mb: 2, color: 'text.primary' }}>
                        {t('mergeDatabaseWarning')}
                    </DialogContentText>
                    <Box component="ul" sx={{ mt: 0, mb: 2, pl: 3, color: 'text.primary' }}>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            {t('mergeDatabaseContentsVideos')}
                        </Typography>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            {t('mergeDatabaseContentsCollections')}
                        </Typography>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            {t('mergeDatabaseContentsSubscriptions')}
                        </Typography>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            {t('mergeDatabaseContentsHistory')}
                        </Typography>
                        <Typography component="li" variant="body2">
                            {t('mergeDatabaseContentsTags')}
                        </Typography>
                    </Box>
                    <DialogContentText sx={{ mb: 2, color: 'text.secondary' }}>
                        {t('mergeDatabaseKeepsCurrentData')}
                    </DialogContentText>
                    <Button
                        variant="outlined"
                        component="label"
                        startIcon={<Upload />}
                        fullWidth
                        sx={{ borderStyle: 'dashed', height: 56 }}
                    >
                        {selectedMergeFile ? selectedMergeFile.name : t('selectDatabaseFile')}
                        <input
                            ref={mergeFileInputRef}
                            type="file"
                            hidden
                            accept=".db"
                            onChange={handleMergeFileSelect}
                        />
                    </Button>
                    {isScanningMergePreview && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
                            <CircularProgress size={18} />
                            <Typography variant="body2" color="text.secondary">
                                {t('mergeDatabasePreviewScanning')}
                            </Typography>
                        </Box>
                    )}
                    {mergePreviewError && (
                        <DialogContentText sx={{ mt: 2, color: 'error.main' }}>
                            {t('mergeDatabasePreviewFailed', { error: mergePreviewError })}
                        </DialogContentText>
                    )}
                    {mergePreviewSummary && !isScanningMergePreview && !mergePreviewError && (
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                {t('mergeDatabasePreviewResults')}
                            </Typography>
                            {renderMergePreviewRow(t('mergeDatabasePreviewVideos'), mergePreviewSummary.videos)}
                            {renderMergePreviewRow(t('mergeDatabasePreviewCollections'), mergePreviewSummary.collections)}
                            {renderMergePreviewRow(t('mergeDatabasePreviewCollectionLinks'), mergePreviewSummary.collectionLinks)}
                            {renderMergePreviewRow(t('mergeDatabasePreviewSubscriptions'), mergePreviewSummary.subscriptions)}
                            {renderMergePreviewRow(t('mergeDatabasePreviewDownloadHistory'), mergePreviewSummary.downloadHistory)}
                            {renderMergePreviewRow(t('mergeDatabasePreviewVideoDownloads'), mergePreviewSummary.videoDownloads)}
                            {renderMergePreviewRow(t('mergeDatabasePreviewTags'), mergePreviewSummary.tags)}
                            <DialogContentText sx={{ mt: 2, color: 'text.secondary' }}>
                                {t('mergeDatabasePreviewConfirmHint')}
                            </DialogContentText>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={handleCloseMergeModal} disabled={isSaving}>
                        {t('cancel')}
                    </Button>
                    <Button
                        onClick={handleConfirmMerge}
                        variant="contained"
                        color="primary"
                        disabled={!selectedMergeFile || !mergePreviewSummary || Boolean(mergePreviewError) || isScanningMergePreview || isSaving}
                    >
                        {t('mergeDatabase')}
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
