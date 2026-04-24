import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
    Box,
    Button,
    Chip,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { RssToken, UpdateTokenInput } from '../../../utils/rssApi';
import ConfirmationModal from '../../ConfirmationModal';
import RssTokenDialog from './RssTokenDialog';

interface RssTokenCardProps {
    token: RssToken;
    channelOptions?: { channelUrl: string; author: string }[];
    authorOptions?: string[];
    tagOptions?: string[];
    onUpdate: (id: string, patch: UpdateTokenInput) => void;
    onDelete: (id: string) => void;
    onReset: (id: string) => void;
    isUpdating?: boolean;
}

const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
        const clipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
        if (clipboard && typeof clipboard.writeText === 'function') {
            await clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through
    }
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.left = '-999999px';
    document.body.appendChild(el);
    el.select();
    try {
        return document.execCommand('copy');
    } finally {
        document.body.removeChild(el);
    }
};

const RssTokenCard: React.FC<RssTokenCardProps> = ({
    token,
    channelOptions = [],
    authorOptions = [],
    tagOptions = [],
    onUpdate,
    onDelete,
    onReset,
    isUpdating = false,
}) => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    const handleCopy = async () => {
        const ok = await copyToClipboard(token.feedUrl);
        if (ok) showSnackbar(t('rssLinkCopied'), 'success');
    };

    const handleToggleActive = () => {
        onUpdate(token.id, { isActive: !token.isActive });
    };

    const filterSummary = () => {
        const parts: string[] = [];
        if (token.filters.sources?.length) parts.push(token.filters.sources.join(', '));
        if (token.filters.authors?.length) {
            parts.push(t('rssAuthorsSummary', { authors: token.filters.authors.join(', ') }));
        }
        if (token.filters.channelUrls?.length) {
            parts.push(t('rssChannelsSummary', { count: token.filters.channelUrls.length }));
        }
        if (token.filters.tags?.length) {
            parts.push(t('rssTagsSummary', { tags: token.filters.tags.join(', ') }));
        }
        if (token.filters.dayRange) {
            parts.push(t('rssRecentDaysSummary', { days: token.filters.dayRange }));
        }
        return parts.length ? parts.join(' | ') : t('rssFilterAllVideos');
    };

    const createdDate = new Date(token.createdAt).toLocaleDateString();

    return (
        <Box
            sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
            }}
        >
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
                    {token.label || t('rssNoLabel')}
                </Typography>
                <Chip
                    label={token.role}
                    size="small"
                    color={token.role === 'admin' ? 'warning' : 'default'}
                />
                <Chip
                    label={token.isActive ? t('rssActive') : t('rssDisabled')}
                    size="small"
                    color={token.isActive ? 'success' : 'default'}
                />
            </Box>

            {/* Meta */}
            <Typography variant="body2" color="text.secondary">
                {t('rssAccessCount', { date: createdDate, count: token.accessCount })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                {t('rssFiltersSummary', { filters: filterSummary(), maxItems: token.filters.maxItems ?? 50 })}
            </Typography>

            {/* Feed URL */}
            <Typography
                variant="body2"
                sx={{
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    bgcolor: 'action.hover',
                    p: 1,
                    borderRadius: 1,
                }}
            >
                {token.feedUrl}
            </Typography>

            {/* Actions */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                <Button
                    startIcon={<ContentCopyIcon />}
                    onClick={() => {
                        void handleCopy();
                    }}
                    variant="outlined"
                >
                    {t('rssCopyLink')}
                </Button>
                <Button
                    startIcon={<EditIcon />}
                    onClick={() => {
                        setShowEditDialog(true);
                    }}
                    variant="outlined"
                >
                    {t('rssEditAction')}
                </Button>
                <Button
                    startIcon={<RefreshIcon />}
                    onClick={() => {
                        setShowResetConfirm(true);
                    }}
                    variant="outlined"
                    color="warning"
                >
                    {t('rssResetLink')}
                </Button>
                <Button
                    onClick={handleToggleActive}
                    variant="outlined"
                    color={token.isActive ? 'error' : 'success'}
                    disabled={isUpdating}
                >
                    {token.isActive ? t('rssDisableLink') : t('rssEnableLink')}
                </Button>
                <Button
                    startIcon={<DeleteIcon />}
                    onClick={() => {
                        setShowDeleteConfirm(true);
                    }}
                    variant="outlined"
                    color="error"
                >
                    {t('rssDeleteLink')}
                </Button>
            </Box>

            {/* Edit dialog */}
            <RssTokenDialog
                open={showEditDialog}
                mode="edit"
                token={token}
                channelOptions={channelOptions}
                authorOptions={authorOptions}
                tagOptions={tagOptions}
                onClose={() => {
                    setShowEditDialog(false);
                }}
                onUpdate={(id, patch) => {
                    onUpdate(id, patch);
                    setShowEditDialog(false);
                }}
                isLoading={isUpdating}
            />

            {/* Delete confirmation */}
            <ConfirmationModal
                isOpen={showDeleteConfirm}
                title={t('rssDeleteLink')}
                message={t('rssDeleteLinkConfirm')}
                confirmText={t('delete')}
                cancelText={t('cancel')}
                onConfirm={() => {
                    setShowDeleteConfirm(false);
                    onDelete(token.id);
                }}
                onClose={() => {
                    setShowDeleteConfirm(false);
                }}
                isDanger
            />

            {/* Reset confirmation */}
            <ConfirmationModal
                isOpen={showResetConfirm}
                title={t('rssResetLink')}
                message={t('rssResetLinkConfirm')}
                confirmText={t('reset')}
                cancelText={t('cancel')}
                onConfirm={() => {
                    setShowResetConfirm(false);
                    onReset(token.id);
                }}
                onClose={() => {
                    setShowResetConfirm(false);
                }}
                isDanger
            />
        </Box>
    );
};

export default RssTokenCard;
