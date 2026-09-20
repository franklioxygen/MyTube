import {
    Box,
    Container,
    Grid,
    Typography
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import ExternalSearchSection from '../components/ExternalSearchSection';
import SortControl from '../components/SortControl';
import VideoCard from '../components/VideoCard';
import { useCollection } from '../contexts/CollectionContext';
import { useDownload } from '../contexts/DownloadContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { VideoSearchResult } from '../types';
import { getRandomSeed, sortVideos, validateSortOption } from '../utils/videoSort';

const SearchPage: React.FC = () => {
    const { t } = useLanguage();
    const {
        deleteVideo,
        localSearchResults,
        searchResults,
        youtubeLoading,
        handleSearch,
        searchTerm: contextSearchTerm,
        lastSearchEventId,
        showYoutubeSearch,
        loadMoreSearchResults,
        loadingMore,
        bilibiliSearchResults,
        bilibiliLoading,
        showBilibiliSearch,
        loadMoreBilibiliSearchResults,
        loadingMoreBilibili
    } = useVideo();
    const { collections } = useCollection();
    const { handleVideoSubmit } = useDownload();
    const [searchParams, setSearchParams] = useSearchParams();
    const [downloadingIds, setDownloadingIds] = useState<ReadonlySet<string>>(() => new Set());

    const sortOption = validateSortOption(searchParams.get('sort'), 'dateDesc');
    const shuffleSeed =
        sortOption === 'random'
            ? Math.max(0, parseInt(searchParams.get('seed') || '0', 10) || 0)
            : 0;
    const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null);

    const query = searchParams.get('q');

    useEffect(() => {
        if (query && query !== contextSearchTerm) {
            handleSearch(query);
        }
    }, [query, contextSearchTerm, handleSearch]);

    const handleSortClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setSortAnchorEl(event.currentTarget);
    };

    const handleSortClose = (option?: string) => {
        if (option) {
            const validatedOption = validateSortOption(option, 'dateDesc');
            setSearchParams((prev: URLSearchParams) => {
                const newParams = new URLSearchParams(prev);

                if (validatedOption === 'random') {
                    newParams.set('sort', 'random');
                    newParams.set('seed', getRandomSeed().toString());
                } else {
                    newParams.set('sort', validatedOption);
                    newParams.delete('seed');
                }
                return newParams;
            });
        }
        setSortAnchorEl(null);
    };

    const markDownloading = (videoId: string, active: boolean) => {
        setDownloadingIds((prev) => {
            if (prev.has(videoId) === active) {
                return prev;
            }
            const next = new Set(prev);
            if (active) {
                next.add(videoId);
            } else {
                next.delete(videoId);
            }
            return next;
        });
    };

    const handleDownload = async (videoId: string, url: string) => {
        try {
            markDownloading(videoId, true);
            await handleVideoSubmit(url, false, {
                relatedEventId: lastSearchEventId,
                sourceKind: 'search_result',
                surface: 'web'
            });
        } catch (error) {
            console.error('Error downloading from search:', error);
        } finally {
            markDownloading(videoId, false);
        }
    };

    const handleResultDownload = (result: VideoSearchResult) => {
        void handleDownload(result.id, result.sourceUrl);
    };

    const hasLocalResults = localSearchResults && localSearchResults.length > 0;

    const sortedLocalSearchResults = useMemo(() => {
        return sortVideos(localSearchResults, sortOption, shuffleSeed);
    }, [localSearchResults, sortOption, shuffleSeed]);

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('searchResultsFor')} "{query}"
                </Typography>
            </Box>

            {/* Local Video Results */}
            <Box sx={{ mb: 6 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <Typography variant="h5" sx={{ fontWeight: 600, color: 'primary.main' }}>
                        {t('fromYourLibrary')}
                    </Typography>

                    {hasLocalResults && (
                        <SortControl
                            sortOption={sortOption}
                            sortAnchorEl={sortAnchorEl}
                            onSortClick={handleSortClick}
                            onSortClose={handleSortClose}
                        />
                    )}
                </Box>

                {hasLocalResults ? (
                    <Grid container spacing={3}>
                        {sortedLocalSearchResults.map((video) => (
                            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={video.id}>
                                <VideoCard
                                    video={video}
                                    collections={collections}
                                    onDeleteVideo={deleteVideo}
                                    showDeleteButton={true}
                                    disableCollectionGrouping={true}
                                    statisticsRelatedEventId={lastSearchEventId}
                                />
                            </Grid>
                        ))}
                    </Grid>
                ) : (
                    <Typography color="text.secondary">{t('noMatchingVideos')}</Typography>
                )}
            </Box>

            {/* YouTube Search Results */}
            {showYoutubeSearch && (
                <ExternalSearchSection
                    source="youtube"
                    heading={t('fromYouTube')}
                    loadingLabel={t('loadingYouTubeResults')}
                    emptyLabel={t('noYouTubeResults')}
                    results={searchResults}
                    loading={youtubeLoading}
                    loadingMore={loadingMore}
                    onLoadMore={loadMoreSearchResults}
                    onDownload={handleResultDownload}
                    downloadingIds={downloadingIds}
                />
            )}

            {/* Bilibili Search Results */}
            {showBilibiliSearch && (
                <Box sx={{ mt: showYoutubeSearch ? 6 : 0 }}>
                    <ExternalSearchSection
                        source="bilibili"
                        heading={t('fromBilibili')}
                        loadingLabel={t('loadingBilibiliResults')}
                        emptyLabel={t('noBilibiliResults')}
                        results={bilibiliSearchResults}
                        loading={bilibiliLoading}
                        loadingMore={loadingMoreBilibili}
                        onLoadMore={loadMoreBilibiliSearchResults}
                        onDownload={handleResultDownload}
                        downloadingIds={downloadingIds}
                    />
                </Box>
            )}
        </Container>
    );
};

export default SearchPage;
