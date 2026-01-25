import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    TextField,
    Typography
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useSettings } from '../hooks/useSettings';
import { useSettingsMutations } from '../hooks/useSettingsMutations';

interface TagsModalProps {
    open: boolean;
    onClose: () => void;
    videoTags: string[];
    availableTags: string[];
    onSave: (tags: string[]) => Promise<void>;
}

const TagsModal: React.FC<TagsModalProps> = ({
    open,
    onClose,
    videoTags,
    availableTags = [],
    onSave
}) => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();

    // Settings hooks for global tag updates
    const { data: globalSettings } = useSettings();
    const { saveMutation } = useSettingsMutations({
        setMessage: (msg) => msg && showSnackbar(msg.text, msg.type),
        setInfoModal: () => { /* No-op: TagsModal doesn't use info modals */ }
    });

    // State for selected tags (starts with videoTags)
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [newTag, setNewTag] = useState('');
    const [saving, setSaving] = useState(false);

    // Reset state when modal opens
    useEffect(() => {
        if (open) {
            setSelectedTags(videoTags || []);
            setNewTag('');
            setSaving(false);
        }
    }, [open, videoTags]);

    const handleToggleTag = (tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag)
                ? prev.filter(t => t !== tag)
                : [...prev, tag]
        );
    };

    const handleAddNewTag = () => {
        const trimmedTag = newTag.trim();
        if (trimmedTag && !selectedTags.includes(trimmedTag)) {
            setSelectedTags(prev => [...prev, trimmedTag]);
            setNewTag('');
        }
    };

    const handleSave = async () => {
        setSaving(true);

        try {
            // Check for new tags that need to be added to global settings
            const newGlobalTags = selectedTags.filter(tag => !availableTags.includes(tag));

            if (newGlobalTags.length > 0 && globalSettings) {
                // Update global settings with new tags
                const currentTags = globalSettings.tags || [];
                // Merge and deduplicate
                const updatedTags = Array.from(new Set([...currentTags, ...newGlobalTags])).sort();

                const newSettings = {
                    ...globalSettings,
                    tags: updatedTags
                };

                // Await the settings mutation to ensure settings are updated before continuing
                // This ensures that availableTags is refreshed in all components
                await saveMutation.mutateAsync(newSettings);
            }

            // Save video tags - this will update the video in the videos list
            await onSave(selectedTags);
            handleClose();
        } catch (error: any) {
            // Extract error message from various error formats
            const errorMessage = error?.message ||
                error?.response?.data?.error ||
                error?.error ||
                t('failedToSaveTags') ||
                'Failed to save tags';
            showSnackbar(errorMessage, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleClose = () => {
        if (!saving) {
            onClose();
        }
    };

    // Combine available tags with any newly added selected tags that aren't in availableTags yet
    // Prefer globalSettings from hook if available to ensure we have the latest data after settings updates
    const effectiveAvailableTags = globalSettings?.tags && Array.isArray(globalSettings.tags)
        ? globalSettings.tags
        : (Array.isArray(availableTags) ? availableTags : []);

    const safeAvailableTags = effectiveAvailableTags;
    const displayTags = Array.from(new Set([...safeAvailableTags, ...selectedTags])).sort();

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>{t('selectTags')}</DialogTitle>
            <DialogContent dividers>
                <Box sx={{ mb: 3 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                        <TextField
                            fullWidth
                            size="small"
                            label={t('newTag') || 'New Tag'}
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddNewTag()}
                        />
                        <Button
                            variant="contained"
                            onClick={handleAddNewTag}
                            disabled={!newTag.trim()}
                        >
                            {t('add') || 'Add'}
                        </Button>
                    </Stack>
                </Box>

                <Box>
                    <Typography variant="subtitle2" gutterBottom>{t('tags')}</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {displayTags.map(tag => (
                            <Chip
                                key={tag}
                                label={tag}
                                onClick={() => handleToggleTag(tag)}
                                color={selectedTags.includes(tag) ? 'primary' : 'default'}
                                variant={selectedTags.includes(tag) ? 'filled' : 'outlined'}
                                sx={{ cursor: 'pointer' }}
                            />
                        ))}
                        {displayTags.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                                {t('noTagsAvailable') || 'No tags available'}
                            </Typography>
                        )}
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} color="inherit" disabled={saving}>{t('cancel')}</Button>
                <Button onClick={handleSave} variant="contained" disabled={saving}>
                    {saving ? t('saving') : t('save')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TagsModal;
