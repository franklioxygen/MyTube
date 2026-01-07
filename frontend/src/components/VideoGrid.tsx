import { Grid } from '@mui/material';
import React, { useMemo } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { ViewMode } from '../hooks/useViewMode';
import { Collection, Video } from '../types';
import CollectionCard from './CollectionCard';
import VideoCard from './VideoCard';

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
}

export const VideoGrid: React.FC<VideoGridProps> = ({
    videos,
    sortedVideos,
    displayedVideos,
    collections,
    viewMode,
    infiniteScroll,
    gridProps,
    onDeleteVideo
}) => {
    // Components for VirtuosoGrid - MUST be defined before any conditional returns
    // Using useMemo to create stable component references
    // These components must work with virtualization - avoid forcing all items to render
    const VirtuosoList = useMemo(() =>
        React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Grid>>((props, ref) => {
            // Extract style and other props, but ensure we don't force all items to render
            const { style, ...restProps } = props;
            return (
                <Grid
                    container
                    rowSpacing={{ xs: 2, sm: 3 }}
                    columnSpacing={{ xs: 0, sm: 3 }}
                    {...restProps}
                    ref={ref}
                    style={{
                        ...style,
                        display: 'flex',
                        flexWrap: 'wrap',
                        // Critical: Don't set height or minHeight that would force all items to render
                        // Let VirtuosoGrid handle the height calculation
                    }}
                />
            );
        }),
        []
    );

    const VirtuosoItem = useMemo(() =>
        React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Grid>>((props, ref) => {
            const { style, ...restProps } = props;
            return (
                <Grid
                    size={gridProps}
                    {...restProps}
                    ref={ref}
                    style={{
                        ...style,
                        // Remove width override to let Grid handle sizing
                        // VirtuosoGrid will manage which items are rendered
                    }}
                />
            );
        }),
        [gridProps]
    );

    const renderVideoItem = (video: Video) => {
        // In all-videos and history mode, ALWAYS render as VideoCard
        if (viewMode === 'all-videos' || viewMode === 'history') {
            return (
                <VideoCard
                    video={video}
                    collections={collections}
                    disableCollectionGrouping={true}
                    onDeleteVideo={onDeleteVideo}
                    showDeleteButton={true}
                />
            );
        }

        // In collections mode, check if this video is the first in a collection
        const collection = collections.find(c => c.videos[0] === video.id);

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
            />
        );
    };

    if (infiniteScroll) {
        return (
            <VirtuosoGrid
                key={`virtuoso-${viewMode}-${sortedVideos.length}`}
                useWindowScroll
                data={sortedVideos}
                components={{
                    List: VirtuosoList,
                    Item: VirtuosoItem
                }}
                overscan={5}
                itemContent={(_index, video) => renderVideoItem(video)}
            />
        );
    }

    return (
        <Grid
            container
            rowSpacing={{ xs: 2, sm: 3 }}
            columnSpacing={{ xs: 0, sm: 3 }}
        >
            {displayedVideos.map((video) => {
                // In all-videos and history mode, ALWAYS render as VideoCard
                if (viewMode === 'all-videos' || viewMode === 'history') {
                    return (
                        <Grid size={gridProps} key={video.id}>
                            {renderVideoItem(video)}
                        </Grid>
                    );
                }

                // In collections mode, check if this video is the first in a collection
                const collection = collections.find(c => c.videos[0] === video.id);

                // If it is, render CollectionCard
                if (collection) {
                    return (
                        <Grid size={gridProps} key={`collection-${collection.id}`}>
                            <CollectionCard
                                collection={collection}
                                videos={videos}
                            />
                        </Grid>
                    );
                }

                // Otherwise render VideoCard for non-collection videos
                return (
                    <Grid size={gridProps} key={video.id}>
                        {renderVideoItem(video)}
                    </Grid>
                );
            })}
        </Grid>
    );
};
