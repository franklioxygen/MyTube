import { Box, Container, Grid, Skeleton, useMediaQuery, useTheme } from '@mui/material';
import type { FC } from 'react';

interface GridProps {
    xs?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
}

interface HomeLoadingSkeletonProps {
    gridProps: GridProps;
    isSidebarOpen: boolean;
    cardsCount: number;
}

export const HomeLoadingSkeleton: FC<HomeLoadingSkeletonProps> = ({
    gridProps,
    isSidebarOpen,
    cardsCount
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const placeholders = Array.from({ length: cardsCount });

    return (
        <Container
            maxWidth={false}
            data-testid="home-loading-skeleton"
            sx={{ py: 4, px: { xs: 0, sm: 3 } }}
        >
            <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
                {!isMobile && isSidebarOpen && (
                    <Box
                        sx={{
                            width: { md: 240, lg: 280 },
                            flexShrink: 0,
                            px: 2,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2
                        }}
                    >
                        <Skeleton variant="rounded" height={48} />
                        <Skeleton variant="rounded" height={220} />
                        <Skeleton variant="rounded" height={260} />
                    </Box>
                )}

                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ mb: 3, px: { xs: 2, sm: 0 } }}>
                        <Skeleton variant="rounded" height={56} />
                    </Box>

                    <Grid
                        container
                        rowSpacing={{ xs: 2, sm: 3 }}
                        columnSpacing={{ xs: 0, sm: 3 }}
                    >
                        {placeholders.map((_, index) => (
                            <Grid size={gridProps} key={index}>
                                <Box
                                    sx={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 1.5,
                                        px: { xs: 0, sm: 0 }
                                    }}
                                >
                                    <Box sx={{ position: 'relative', pt: '56.25%' }}>
                                        <Skeleton
                                            variant="rectangular"
                                            sx={{
                                                position: 'absolute',
                                                inset: 0,
                                                transform: 'none',
                                                borderRadius: isMobile ? 0 : 2
                                            }}
                                        />
                                    </Box>
                                    <Box sx={{ px: 2, pb: 2 }}>
                                        <Skeleton variant="text" height={32} />
                                        <Skeleton variant="text" width="65%" />
                                    </Box>
                                </Box>
                            </Grid>
                        ))}
                    </Grid>
                </Box>
            </Box>
        </Container>
    );
};
