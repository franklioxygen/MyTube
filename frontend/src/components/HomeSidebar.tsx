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
        // The flex item itself is sticky and self-scrolling. Because it stays
        // in normal flow (no absolute positioning), a long list contributes to
        // the row height and can never overlap the footer, while its own
        // overflow caps it to the viewport. `alignSelf: flex-start` keeps it
        // from stretching to the video column so it retains room to stick while
        // the grid scrolls.
        <Box sx={{
            display: { xs: 'none', md: 'block' },
            alignSelf: 'flex-start',
            position: 'sticky',
            top: 16,
            maxHeight: 'calc(100vh - 32px)',
            overflowY: 'auto',
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
        }}>
            <Collapse
                in={isSidebarOpen}
                orientation="horizontal"
                timeout={300}
            >
                <Box sx={{ width: 280, mr: 4, flexShrink: 0 }}>
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
