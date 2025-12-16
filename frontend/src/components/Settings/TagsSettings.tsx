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

    // Ensure tags is always an array
    const tagsArray = Array.isArray(tags) ? tags : [];

    const handleAddTag = () => {
        if (newTag && !tagsArray.includes(newTag)) {
            onTagsChange([...tagsArray, newTag]);
            setNewTag('');
        }
    };

    const handleDeleteTag = (tagToDelete: string) => {
        onTagsChange(tagsArray.filter(tag => tag !== tagToDelete));
    };

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('tagsManagement') || 'Tags Management'}</Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {tagsArray.length > 0 && tagsArray.map((tag) => (
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
