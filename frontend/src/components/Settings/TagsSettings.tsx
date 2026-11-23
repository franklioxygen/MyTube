import {
    Autocomplete,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControlLabel,
    Switch,
    TextField,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { SETTINGS_CONTROL_MAX_WIDTH } from './settingsLayout';

interface TagsSettingsProps {
    tags: string[];
    onTagsChange: (tags: string[]) => void;
    onRenameTag?: (oldTag: string, newTag: string) => void;
    onTagConflict?: () => void;
    isRenaming?: boolean;
    autoTagsFromSource?: boolean;
    onAutoTagsFromSourceChange?: (enabled: boolean) => void;
    tagAliases?: Record<string, string>;
    onTagAliasesChange?: (aliases: Record<string, string>) => void;
    onTagAliasInvalid?: () => void;
}

// Mirrors the backend's alias rules (utils/sourceTags.ts).
const MAX_TAG_ALIAS_LENGTH = 64;
const cleanAliasPart = (value: string) =>
    value.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();

const TagsSettings: React.FC<TagsSettingsProps> = ({
    tags,
    onTagsChange,
    onRenameTag,
    onTagConflict,
    isRenaming = false,
    autoTagsFromSource = false,
    onAutoTagsFromSourceChange,
    tagAliases = {},
    onTagAliasesChange,
    onTagAliasInvalid,
}) => {
    const { t } = useLanguage();
    const [newTag, setNewTag] = useState('');
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [tagToRename, setTagToRename] = useState<string | null>(null);
    const [newTagName, setNewTagName] = useState('');
    const [aliasDraft, setAliasDraft] = useState('');
    const [aliasTargetDraft, setAliasTargetDraft] = useState('');

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

    const handleAddAlias = () => {
        if (!onTagAliasesChange) return;
        const alias = cleanAliasPart(aliasDraft).toLowerCase();
        const target = cleanAliasPart(aliasTargetDraft);
        if (!alias || !target) return;
        const otherAliases = Object.entries(tagAliases).filter(([key]) => key !== alias);
        const isChain =
            otherAliases.some(([key]) => key === target.toLowerCase()) ||
            otherAliases.some(([, value]) => value.toLowerCase() === alias);
        if (
            alias === target.toLowerCase() ||
            isChain ||
            alias.length > MAX_TAG_ALIAS_LENGTH ||
            target.length > MAX_TAG_ALIAS_LENGTH
        ) {
            onTagAliasInvalid?.();
            return;
        }
        onTagAliasesChange({ ...tagAliases, [alias]: target });
        setAliasDraft('');
        setAliasTargetDraft('');
    };

    const handleDeleteAlias = (alias: string) => {
        if (!onTagAliasesChange) return;
        const next = { ...tagAliases };
        delete next[alias];
        onTagAliasesChange(next);
    };

    const aliasEntries = Object.entries(tagAliases);

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('tagsManagement') || 'Tags Management'}</Typography>
            {onAutoTagsFromSourceChange && (
                <Box sx={{ mb: 2 }} id="autoTagsFromSource-setting">
                    <FormControlLabel
                        control={
                            <Switch
                                checked={autoTagsFromSource}
                                onChange={(event) => onAutoTagsFromSourceChange(event.target.checked)}
                            />
                        }
                        label={t('autoTagsFromSource')}
                    />
                    <Typography variant="body2" color="text.secondary">
                        {t('autoTagsFromSourceDescription')}
                    </Typography>
                </Box>
            )}
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
            <Box sx={{ display: 'flex', gap: 1, maxWidth: SETTINGS_CONTROL_MAX_WIDTH }}>
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

            {onTagAliasesChange && (
                <Box sx={{ mt: 3 }} id="tagAliases-setting">
                    <Typography variant="subtitle1">{t('tagAliases')}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {t('tagAliasesDescription')}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                        {aliasEntries.length > 0 ? aliasEntries.map(([alias, target]) => (
                            <Chip
                                key={alias}
                                label={`${alias} → ${target}`}
                                variant="outlined"
                                onDelete={() => handleDeleteAlias(alias)}
                            />
                        )) : (
                            <Typography variant="body2" color="text.secondary">
                                {t('noTagAliases')}
                            </Typography>
                        )}
                    </Box>
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: { xs: 'column', sm: 'row' },
                            gap: 1,
                            maxWidth: SETTINGS_CONTROL_MAX_WIDTH,
                        }}
                    >
                        <TextField
                            label={t('tagAlias')}
                            value={aliasDraft}
                            onChange={(e) => setAliasDraft(e.target.value)}
                            size="small"
                            fullWidth
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddAlias();
                            }}
                        />
                        <Autocomplete
                            freeSolo
                            fullWidth
                            options={tagsArray}
                            inputValue={aliasTargetDraft}
                            onInputChange={(_, value) => setAliasTargetDraft(value)}
                            renderInput={(params) => (
                                <TextField {...params} label={t('tagAliasTarget')} size="small" />
                            )}
                        />
                        <Button variant="contained" onClick={handleAddAlias} sx={{ flexShrink: 0 }}>
                            {t('add') || 'Add'}
                        </Button>
                    </Box>
                </Box>
            )}

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
                    <Button
                        onClick={handleRenameSubmit}
                        disabled={!newTagName || newTagName === tagToRename}
                        loading={isRenaming}
                        loadingPosition="start"
                    >
                        {t('confirmRenameTag') || 'Rename'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TagsSettings;
