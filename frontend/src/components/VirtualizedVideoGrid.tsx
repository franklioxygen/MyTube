import { Grid } from '@mui/material';
import React, { useMemo } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { Video } from '../types';

interface GridProps {
    xs: number;
    sm: number;
    md?: number;
    lg: number;
    xl: number;
}

interface VirtualizedVideoGridProps {
    sortedVideos: Video[];
    gridProps: GridProps;
    renderVideoItem: (video: Video, index: number) => React.ReactNode;
}

const VirtualizedVideoGrid: React.FC<VirtualizedVideoGridProps> = ({
    sortedVideos,
    gridProps,
    renderVideoItem
}) => {
    const VirtuosoList = useMemo(() => {
        const List = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Grid>>((props, ref) => {
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
                    }}
                />
            );
        });

        List.displayName = 'VirtualizedVideoGridList';
        return List;
    }, []);

    const VirtuosoItem = useMemo(() => {
        const Item = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Grid>>((props, ref) => {
            const { style, ...restProps } = props;
            return (
                <Grid
                    size={gridProps}
                    {...restProps}
                    ref={ref}
                    style={style}
                />
            );
        });

        Item.displayName = 'VirtualizedVideoGridItem';
        return Item;
    }, [gridProps]);

    return (
        <VirtuosoGrid
            key={`virtuoso-${sortedVideos.length}`}
            useWindowScroll
            data={sortedVideos}
            components={{
                List: VirtuosoList,
                Item: VirtuosoItem
            }}
            overscan={5}
            itemContent={(index, video) => renderVideoItem(video, index)}
        />
    );
};

export default VirtualizedVideoGrid;
