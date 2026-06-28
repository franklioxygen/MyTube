import { Add, LocalOffer } from '@mui/icons-material';
import { Autocomplete, Box, Chip, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import TagsModal from '../../TagsModal';

interface VideoTagsProps {
    tags: string[] | undefined;
    availableTags: string[];
    onTagsUpdate: (tags: string[]) => Promise<void>;
}

const VideoTags: React.FC<VideoTagsProps> = ({ tags, availableTags, onTagsUpdate }) => {
    const { t } = useLanguage();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [open, setOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);

    // Ensure tags and availableTags are always arrays
    const tagsArray = Array.isArray(tags) ? tags : [];
    const availableTagsArray = Array.isArray(availableTags) ? availableTags : [];

    // On touch/mobile the inline autocomplete dropdown is awkward: it's anchored to
    // a tiny input and the on-screen keyboard covers it. Show the current tags as
    // chips and edit them through the centered TagsModal dialog instead.
    if (isMobile) {
        return (
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, mt: 2, flexWrap: 'wrap' }}>
                <LocalOffer color="action" fontSize="small" />
                {tagsArray.length > 0 ? (
                    tagsArray.map((tag) => (
                        <Chip key={tag} label={tag} size="small" variant="outlined" />
                    ))
                ) : (
                    <Typography variant="body2" color="text.secondary">
                        {t('tags') || 'Tags'}
                    </Typography>
                )}
                <Chip
                    icon={<Add fontSize="small" />}
                    label={t('addTags') || 'Add Tags'}
                    size="small"
                    variant="outlined"
                    color="primary"
                    onClick={() => setModalOpen(true)}
                    sx={{ cursor: 'pointer' }}
                />
                <TagsModal
                    open={modalOpen}
                    onClose={() => setModalOpen(false)}
                    videoTags={tagsArray}
                    availableTags={availableTagsArray}
                    onSave={onTagsUpdate}
                />
            </Box>
        );
    }

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
                freeSolo
                filterOptions={(options, params) => {
                    const { inputValue } = params;
                    // Default filter
                    const filtered = options.filter(option =>
                        option.toLowerCase().includes(inputValue.toLowerCase())
                    );

                    // Suggest the creation of a new value if it doesn't match exactly
                    const isExisting = options.some((option) => inputValue === option);
                    if (inputValue !== '' && !isExisting) {
                        // Insert at the beginning to prioritize the user's exact input 
                        // over a case-insensitive match from the list
                        filtered.unshift(inputValue);
                    }

                    return filtered;
                }}
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

