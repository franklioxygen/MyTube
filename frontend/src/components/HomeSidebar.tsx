import { Box, Collapse } from '@mui/material';
import React from 'react';
import AuthorsList from './AuthorsList';
import Collections from './Collections';
import TagsList from './TagsList';
import { Collection, Video } from '../types';

interface HomeSidebarProps {
    isSidebarOpen: boolean;
    collections: Collection[];
    availableTags: string[];
    selectedTags: string[];
    onTagToggle: (tag: string) => void;
    videos: Video[];
}

export const HomeSidebar: React.FC<HomeSidebarProps> = ({
    isSidebarOpen,
    collections,
    availableTags,
    selectedTags,
    onTagToggle,
    videos
}) => {
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
                            <Collections collections={collections} />
                            <Box sx={{ mt: 2 }}>
                                <TagsList
                                    availableTags={availableTags}
                                    selectedTags={selectedTags}
                                    onTagToggle={onTagToggle}
                                />
                            </Box>
                            <Box sx={{ mt: 2 }}>
                                <AuthorsList videos={videos} />
                            </Box>
                        </Box>
                    </Box>
                </Box>
            </Collapse>
        </Box>
    );
};
