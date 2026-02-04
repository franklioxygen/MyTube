import { Box, Collapse, Paper, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import TagsList from './TagsList';

interface TagsSidebarProps {
    isSidebarOpen: boolean;
    availableTags: string[];
    selectedTags: string[];
    onTagToggle: (tag: string) => void;
}

export const TagsSidebar: React.FC<TagsSidebarProps> = ({
    isSidebarOpen,
    availableTags,
    selectedTags,
    onTagToggle
}) => {
    const { t } = useLanguage();
    const hasTags = Array.isArray(availableTags) && availableTags.length > 0;

    return (
        <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <Collapse
                in={isSidebarOpen}
                orientation="horizontal"
                timeout={300}
                sx={{
                    height: '100%',
                    '& .MuiCollapse-wrapper': { height: '100%' },
                    '& .MuiCollapse-wrapperInner': { height: '100%' }
                }}
            >
                <Box sx={{ width: 280, mr: 4, flexShrink: 0, height: '100%', position: 'relative' }}>
                    <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                        <Box sx={{
                            position: 'sticky',
                            maxHeight: 'calc(100% - 80px)',
                            minHeight: 'calc(100vh - 80px)',
                            overflowY: 'auto',
                            '&::-webkit-scrollbar': {
                                width: '6px',
                            },
                            '&::-webkit-scrollbar-track': {
                                background: 'transparent',
                            },
                            '&::-webkit-scrollbar-thumb': {
                                background: 'rgba(0,0,0,0.1)',
                                borderRadius: '3px',
                            },
                            '&:hover::-webkit-scrollbar-thumb': {
                                background: 'rgba(0,0,0,0.2)',
                            },
                        }}>
                            {hasTags ? (
                                <TagsList
                                    availableTags={availableTags}
                                    selectedTags={selectedTags}
                                    onTagToggle={onTagToggle}
                                />
                            ) : (
                                <Paper elevation={0} sx={{ bgcolor: 'transparent' }}>
                                    <Typography variant="h6" component="div" sx={{ fontWeight: 600, mb: 1 }}>
                                        {t('tags') || 'Tags'}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ px: 0, pb: 2 }}>
                                        {t('noTagsAvailable')}
                                    </Typography>
                                </Paper>
                            )}
                        </Box>
                    </Box>
                </Box>
            </Collapse>
        </Box>
    );
};
