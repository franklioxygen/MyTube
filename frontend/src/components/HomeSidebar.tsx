import { Box, Collapse } from '@mui/material';
import React from 'react';
import { overlay } from '../theme/colors';
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
    maxPanelHeight?: number | null;
}

export const HomeSidebar: React.FC<HomeSidebarProps> = ({
    isSidebarOpen,
    collections,
    availableTags,
    selectedTags,
    onTagToggle,
    videos,
    maxPanelHeight
}) => {
    return (
        // Keep the flex item itself free of vertical scrollbars. Otherwise the
        // 6px custom scrollbar can appear after first layout and shrink the
        // main video column.
        <Box sx={{
            display: { xs: 'none', md: 'block' },
            alignSelf: 'flex-start',
            position: 'sticky',
            top: 16,
            maxHeight: 'calc(100vh - 32px)',
            overflowX: 'hidden',
            flexShrink: 0,
        }} data-testid="home-sidebar">
            <Collapse
                in={isSidebarOpen}
                orientation="horizontal"
                timeout={300}
            >
                <Box sx={{
                    width: { md: 260, lg: 280 },
                    mr: { md: 3, lg: 4 },
                    flexShrink: 0,
                    minWidth: 0,
                    maxHeight: maxPanelHeight ? `min(${maxPanelHeight}px, calc(100vh - 32px))` : 'calc(100vh - 32px)',
                    overflowY: isSidebarOpen ? 'auto' : 'hidden',
                    overflowX: 'hidden',
                    '&::-webkit-scrollbar': {
                        width: '6px',
                    },
                    '&::-webkit-scrollbar-track': {
                        background: 'transparent',
                    },
                    '&::-webkit-scrollbar-thumb': {
                        background: overlay.sidebarTrack,
                        borderRadius: '3px',
                    },
                    '&:hover::-webkit-scrollbar-thumb': {
                        background: overlay.sidebarThumb,
                    },
                }} data-testid="home-sidebar-panel">
                    <Collections collections={collections} />
                    <Box sx={{ mt: 2 }}>
                        <TagsList
                            availableTags={availableTags}
                            selectedTags={selectedTags}
                            onTagToggle={onTagToggle}
                            videos={videos}
                            linkToAllTags
                        />
                    </Box>
                    <Box sx={{ mt: 2 }}>
                        <AuthorsList videos={videos} />
                    </Box>
                </Box>
            </Collapse>
        </Box>
    );
};
