import { LocalOffer } from '@mui/icons-material';
import { Autocomplete, Box, Chip, TextField } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface VideoTagsProps {
    tags: string[] | undefined;
    availableTags: string[];
    onTagsUpdate: (tags: string[]) => Promise<void>;
}

const VideoTags: React.FC<VideoTagsProps> = ({ tags, availableTags, onTagsUpdate }) => {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);

    // Ensure tags and availableTags are always arrays
    const tagsArray = Array.isArray(tags) ? tags : [];
    const availableTagsArray = Array.isArray(availableTags) ? availableTags : [];

    // Combine available tags with video tags to ensure current tags are valid options
    const allOptions = Array.from(new Set([...availableTagsArray, ...tagsArray])).sort();

    return (
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
            <LocalOffer color="action" fontSize="small" />
            <Autocomplete
                multiple
                open={open}
                onOpen={() => setOpen(true)}
                onClose={() => setOpen(false)}
                disableCloseOnSelect
                options={allOptions}
                value={tagsArray}
                isOptionEqualToValue={(option, value) => option === value}
                onChange={(_, newValue) => onTagsUpdate(newValue)}
                slotProps={{
                    chip: { variant: 'outlined', size: 'small' },
                    listbox: {
                        sx: {
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 0.5,
                            p: 1
                        }
                    }
                }}
                renderOption={(props, option, { selected }) => {
                    const { key, ...otherProps } = props;
                    return (
                        <li key={key} {...otherProps} style={{ width: 'auto', padding: 0 }}>
                            <Chip
                                label={option}
                                size="small"
                                variant={selected ? "filled" : "outlined"}
                                color={selected ? "primary" : "default"}
                                sx={{ pointerEvents: 'none' }}
                            />
                        </li>
                    );
                }}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        variant="standard"
                        placeholder={tagsArray.length === 0 ? (t('tags') || 'Tags') : ''}
                        sx={{ minWidth: 300, width: 'auto', display: 'inline-flex' }}
                        slotProps={{
                            input: {
                                ...params.InputProps,
                                disableUnderline: true,
                                readOnly: true,
                                endAdornment: null
                            }
                        }}
                    />
                )}
                sx={{ width: 'auto', display: 'inline-flex' }}
            />
        </Box>
    );
};

export default VideoTags;

