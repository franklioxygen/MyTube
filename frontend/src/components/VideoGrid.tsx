import { Grid, useMediaQuery, useTheme } from '@mui/material';
import React, { Suspense, lazy, useCallback, useMemo } from 'react';
import { ViewMode } from '../hooks/useViewMode';
import { Collection, Video } from '../types';
import CollectionCard from './CollectionCard';
import VideoCard from './VideoCard';

const VirtualizedVideoGrid = lazy(() => import('./VirtualizedVideoGrid'));

interface GridProps {
    xs: number;
    sm: number;
    md?: number;
    lg: number;
    xl: number;
}

interface VideoGridProps {
    videos: Video[];
    sortedVideos: Video[];
    displayedVideos: Video[];
    collections: Collection[];
    viewMode: ViewMode;
    infiniteScroll: boolean;
    gridProps: GridProps;
    onDeleteVideo: (id: string) => Promise<{ success: boolean; error?: string }>;
    showTagsOnThumbnail?: boolean;
}

export const VideoGrid: React.FC<VideoGridProps> = ({
    videos,
    sortedVideos,
    displayedVideos,
    collections,
    viewMode,
    infiniteScroll,
    gridProps,
    onDeleteVideo,
    showTagsOnThumbnail
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const firstVideoCollectionMap = useMemo(() => {
        const map = new Map<string, Collection>();
        for (const collection of collections) {
            const firstVideoId = collection.videos[0];
            if (!firstVideoId || map.has(firstVideoId)) continue;
            map.set(firstVideoId, collection);
        }
        return map;
    }, [collections]);

    const renderVideoItem = useCallback((video: Video, index?: number) => {
        const eagerImageCount = isMobile ? 1 : 3;
        const isHeroImage = index === 0;
        const isAboveTheFold = index !== undefined && index < eagerImageCount;

        // In all-videos and history mode, ALWAYS render as VideoCard
        if (viewMode === 'all-videos' || viewMode === 'history') {
            return (
                <VideoCard
                    video={video}
                    collections={collections}
                    disableCollectionGrouping={true}
                    onDeleteVideo={onDeleteVideo}
                    showDeleteButton={true}
                    isAboveTheFold={isAboveTheFold}
                    isHeroImage={isHeroImage}
                    showTagsOnThumbnail={showTagsOnThumbnail}
                />
            );
        }

        // In collections mode, check if this video is the first in a collection
        const collection = firstVideoCollectionMap.get(video.id);

        if (collection) {
            return (
                <CollectionCard
                    collection={collection}
                    videos={videos}
                />
            );
        }

        // Fallback (shouldn't happen often in collections view unless logic allows loose videos)
        return (
            <VideoCard
                video={video}
                collections={collections}
                onDeleteVideo={onDeleteVideo}
                showDeleteButton={true}
                isAboveTheFold={isAboveTheFold}
                isHeroImage={isHeroImage}
                showTagsOnThumbnail={showTagsOnThumbnail}
            />
        );
    }, [
        collections,
        firstVideoCollectionMap,
        isMobile,
        onDeleteVideo,
        showTagsOnThumbnail,
        videos,
        viewMode
    ]);

    const renderRegularGrid = (items: Video[]) => (
        <Grid
            container
            rowSpacing={{ xs: 2, sm: 3 }}
            columnSpacing={{ xs: 0, sm: 3 }}
        >
            {items.map((video, index) => {
                const collection = firstVideoCollectionMap.get(video.id);
                const itemKey = viewMode === 'collections' && collection
                    ? `collection-${collection.id}`
                    : video.id;

                return (
                    <Grid size={gridProps} key={itemKey}>
                        {renderVideoItem(video, index)}
                    </Grid>
                );
            })}
        </Grid>
    );

    if (infiniteScroll) {
        return (
            <Suspense fallback={renderRegularGrid(sortedVideos)}>
                <VirtualizedVideoGrid
                    sortedVideos={sortedVideos}
                    gridProps={gridProps}
                    renderVideoItem={renderVideoItem}
                />
            </Suspense>
        );
    }

    return renderRegularGrid(displayedVideos);
};
