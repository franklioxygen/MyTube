import { getApiErrorMessage } from '../../utils/errors';
import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    LinearProgress,
    Tooltip,
    Typography,
} from '@mui/material';
import React, { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSettingsJobPolling } from '../../hooks/useSettingsJobPolling';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';
import { RenameJob, renameJobUrl } from './filenameTemplateShared';

interface FilenameBatchRenameSectionProps {
    settings: Settings;
    namingMode: 'legacy' | 'template';
    effectiveTemplate: string;
    // Batch rename must not start while the template in the form is invalid.
    currentTemplateInvalid: boolean;
}

/**
 * "Rename existing library" runner. Owns the rename-job state, its polling,
 * and the post-completion cache invalidation; the parent supplies the current
 * form state (mode/template/validity) the job should apply.
 */
const FilenameBatchRenameSection: React.FC<FilenameBatchRenameSectionProps> = ({
    settings,
    namingMode,
    effectiveTemplate,
    currentTemplateInvalid,
}) => {
    const { t } = useLanguage();
    const queryClient = useQueryClient();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [renameJob, setRenameJob] = useState<RenameJob | null>(null);
    const [renameError, setRenameError] = useState<string | null>(null);
    const [startingRename, setStartingRename] = useState(false);

    // On rename completion the library's paths changed on disk: refresh every
    // query that renders them.
    const handleRenameCompleted = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['videos'] });
        queryClient.invalidateQueries({ queryKey: ['collections'] });
        queryClient.invalidateQueries({ queryKey: ['downloadHistory'] });
    }, [queryClient]);

    useSettingsJobPolling(renameJob, renameJobUrl, setRenameJob, handleRenameCompleted);

    const handleStartRename = async () => {
        setStartingRename(true);
        setRenameError(null);
        try {
            const res = await api.post<{ jobId: string; status: string; total: number }>(
                '/settings/filename-template/rename-all',
                {
                    downloadFilenameMode: namingMode,
                    downloadFilenameTemplate:
                        namingMode === 'template' ? effectiveTemplate : undefined,
                    moveThumbnailsToVideoFolder:
                        settings.moveThumbnailsToVideoFolder || false,
                    moveSubtitlesToVideoFolder:
                        settings.moveSubtitlesToVideoFolder || false,
                }
            );
            const jobData = res.data;
            setRenameJob({
                id: jobData.jobId,
                status: jobData.status as any,
                lockedAt: Date.now(),
                template: effectiveTemplate,
                total: jobData.total,
                processed: 0,
                succeeded: 0,
                skipped: 0,
                failed: 0,
                items: [],
            });
            setConfirmOpen(false);
        } catch (e: unknown) {
            setRenameError(
                getApiErrorMessage(e) || t('filenameBatchRenameError')
            );
        } finally {
            setStartingRename(false);
        }
    };

    const isRenameRunning = renameJob?.status === 'running';
    const isRenameComplete = renameJob?.status === 'completed';

    return (
        <Box sx={{ mt: 3 }}>
            <Typography variant="h6" gutterBottom>
                {t('filenameBatchRenameButton')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('filenameBatchRenameDescription')}
            </Typography>

            {renameError && (
                <Alert severity="error" sx={{ mb: 1, maxWidth: 920 }}>
                    {renameError}
                </Alert>
            )}

            {isRenameRunning && renameJob && (
                <Box sx={{ mb: 2, maxWidth: 520 }}>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                        {t('filenameBatchRenameRunning')} {renameJob.processed}/{renameJob.total}
                        {renameJob.currentTitle && ` – ${renameJob.currentTitle}`}
                    </Typography>
                    <LinearProgress
                        variant="determinate"
                        value={renameJob.total > 0 ? (renameJob.processed / renameJob.total) * 100 : 0}
                    />
                    {renameJob.lockedAt && (
                        <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
                            {t('filenameBatchRenamePaused')}
                        </Typography>
                    )}
                </Box>
            )}

            {isRenameComplete && renameJob && (
                <Alert severity="success" sx={{ mb: 2, maxWidth: 920 }}>
                    {t('filenameBatchRenameComplete')} –{' '}
                    {t('filenameBatchRenameSummary')
                        .replace('{succeeded}', String(renameJob.succeeded))
                        .replace('{skipped}', String(renameJob.skipped))
                        .replace('{failed}', String(renameJob.failed))}
                </Alert>
            )}

            <Tooltip
                title={
                    currentTemplateInvalid
                        ? t('filenameBatchRenameDisabledInvalidTemplate')
                        : isRenameRunning
                            ? t('filenameBatchRenameDisabledRunning')
                            : ''
                }
                disableHoverListener={!currentTemplateInvalid && !isRenameRunning}
            >
                <span>
                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => setConfirmOpen(true)}
                        disabled={isRenameRunning || currentTemplateInvalid}
                    >
                        {t('filenameBatchRenameButton')}
                    </Button>
                </span>
            </Tooltip>

            <Dialog
                open={confirmOpen}
                onClose={() => {
                    if (!startingRename) {
                        setConfirmOpen(false);
                    }
                }}
                disableEscapeKeyDown={startingRename}
            >
                <DialogTitle>{t('filenameBatchRenameConfirmTitle')}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {t('filenameBatchRenameConfirmBody')}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmOpen(false)} disabled={startingRename}>{t('cancel')}</Button>
                    <Button
                        onClick={() => { void handleStartRename(); }}
                        color="warning"
                        variant="contained"
                        loading={startingRename}
                        loadingPosition="start"
                    >
                        {t('filenameBatchRenameConfirm')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default FilenameBatchRenameSection;
