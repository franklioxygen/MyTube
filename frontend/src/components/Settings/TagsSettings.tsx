import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    TextField,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface TagsSettingsProps {
    tags: string[];
    onTagsChange: (tags: string[]) => void;
    onRenameTag?: (oldTag: string, newTag: string) => void;
    onTagConflict?: () => void;
    isRenaming?: boolean;
}

const TagsSettings: React.FC<TagsSettingsProps> = ({ tags, onTagsChange, onRenameTag, onTagConflict, isRenaming = false }) => {
    const { t } = useLanguage();
    const [newTag, setNewTag] = useState('');
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [tagToRename, setTagToRename] = useState<string | null>(null);
    const [newTagName, setNewTagName] = useState('');

    // Ensure tags is always an array
    const tagsArray = Array.isArray(tags) ? tags : [];

    const tagExistsCaseInsensitive = (tag: string) =>
        tagsArray.some((t) => t.toLowerCase() === tag.trim().toLowerCase());

    const handleAddTag = () => {
        const trimmed = newTag.trim();
        if (!trimmed) return;
        if (tagsArray.includes(trimmed)) {
            setNewTag('');
            return;
        }
        if (tagExistsCaseInsensitive(trimmed)) {
            onTagConflict?.();
            return;
        }
        onTagsChange([...tagsArray, trimmed]);
        setNewTag('');
    };

    const handleDeleteTag = (tagToDelete: string) => {
        onTagsChange(tagsArray.filter(tag => tag !== tagToDelete));
    };

    const openRenameDialog = (tag: string) => {
        if (!onRenameTag) return;
        setTagToRename(tag);
        setNewTagName(tag);
        setRenameDialogOpen(true);
    };

    const handleRenameSubmit = () => {
        if (tagToRename && newTagName && newTagName !== tagToRename && onRenameTag) {
            onRenameTag(tagToRename, newTagName);
            // We'll close the dialog immediately, relying on global toast for feedback
            // If we wanted to wait for success, we'd need a more complex interaction
            setRenameDialogOpen(false);
        } else {
            setRenameDialogOpen(false);
        }
    };

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('tagsManagement') || 'Tags Management'}</Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {tagsArray.length > 0 ? tagsArray.map((tag) => (
                    <Chip
                        key={tag}
                        label={tag}
                        onDelete={() => handleDeleteTag(tag)}
                        onClick={onRenameTag ? () => openRenameDialog(tag) : undefined}
                        sx={{ cursor: onRenameTag ? 'pointer' : 'default' }}
                    />
                )) : (
                    <Typography variant="body2" color="text.secondary">
                        {t('noTagsAvailable') || 'No tags available'}
                    </Typography>
                )}
            </Box>
            <Box sx={{ display: 'flex', gap: 1, maxWidth: 400 }}>
                <TextField
                    label={t('newTag') || 'New Tag'}
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    size="small"
                    fullWidth
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            handleAddTag();
                        }
                    }}
                />
                <Button variant="contained" onClick={handleAddTag}>
                    {t('add') || 'Add'}
                </Button>
            </Box>

            {/* Rename Dialog */}
            <Dialog open={renameDialogOpen} onClose={() => !isRenaming && setRenameDialogOpen(false)}>
                <DialogTitle>{t('renameTag') || 'Rename Tag'}</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        {t('enterNewTagName', { tag: tagToRename || '' }) || `Enter new name for tag "${tagToRename}"`}
                    </DialogContentText>
                    {t('renameTagDescription') && (
                        <DialogContentText sx={{ mb: 2, fontSize: '0.875rem' }}>
                            {t('renameTagDescription')}
                        </DialogContentText>
                    )}
                    <TextField
                        autoFocus
                        margin="dense"
                        label={t('newTag') || 'New Tag Name'}
                        fullWidth
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        disabled={isRenaming}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isRenaming) {
                                handleRenameSubmit();
                            }
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRenameDialogOpen(false)} disabled={isRenaming}>
                        {t('cancel') || 'Cancel'}
                    </Button>
                    <Button onClick={handleRenameSubmit} disabled={isRenaming || !newTagName || newTagName === tagToRename}>
                        {isRenaming ? <CircularProgress size={24} /> : (t('confirmRenameTag') || 'Rename')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TagsSettings;
