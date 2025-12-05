import { Box, Button, Chip, TextField, Typography } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface TagsSettingsProps {
    tags: string[];
    onTagsChange: (tags: string[]) => void;
}

const TagsSettings: React.FC<TagsSettingsProps> = ({ tags, onTagsChange }) => {
    const { t } = useLanguage();
    const [newTag, setNewTag] = useState('');

    const handleAddTag = () => {
        if (newTag && !tags.includes(newTag)) {
            onTagsChange([...tags, newTag]);
            setNewTag('');
        }
    };

    const handleDeleteTag = (tagToDelete: string) => {
        onTagsChange(tags.filter(tag => tag !== tagToDelete));
    };

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('tagsManagement') || 'Tags Management'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('tagsManagementNote') || 'Please remember to click "Save Settings" after adding or removing tags to apply changes.'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {tags && tags.map((tag) => (
                    <Chip
                        key={tag}
                        label={tag}
                        onDelete={() => handleDeleteTag(tag)}
                    />
                ))}
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
        </Box>
    );
};

export default TagsSettings;
