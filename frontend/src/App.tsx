import { Box, CircularProgress } from '@mui/material';
import { Suspense, useEffect } from 'react';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './App.css';
import Footer from './components/Footer';
import Header from './components/Header';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CollectionProvider, useCollection } from './contexts/CollectionContext';
import { DownloadProvider, useDownload } from './contexts/DownloadContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { PageTagFilterProvider } from './contexts/PageTagFilterContext';
import { SnackbarProvider } from './contexts/SnackbarContext';
import { ThemeContextProvider } from './contexts/ThemeContext';
import { VideoProvider, useVideo } from './contexts/VideoContext';
import { useSettings } from './hooks/useSettings';
import { defaultQueryConfig } from './utils/queryConfig';
import { lazyWithRetry } from './utils/lazyWithRetry';

const BilibiliPartsModal = lazyWithRetry(
    () => import('./components/BilibiliPartsModal'),
    'bilibili-parts-modal',
);
const AuthorVideos = lazyWithRetry(() => import('./pages/AuthorVideos'), 'author-videos');
const CollectionPage = lazyWithRetry(
    () => import('./pages/CollectionPage'),
    'collection-page',
);
const DownloadPage = lazyWithRetry(() => import('./pages/DownloadPage'), 'download-page');
const Home = lazyWithRetry(() => import('./pages/Home'), 'home-page');
const InstructionPage = lazyWithRetry(
    () => import('./pages/InstructionPage'),
    'instruction-page',
);
const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'), 'login-page');
const ManagePage = lazyWithRetry(() => import('./pages/ManagePage'), 'manage-page');
const SearchPage = lazyWithRetry(() => import('./pages/SearchPage'), 'search-page');
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'), 'settings-page');
const SubscriptionsPage = lazyWithRetry(
    () => import('./pages/SubscriptionsPage'),
    'subscriptions-page',
);
const VideoPlayer = lazyWithRetry(() => import('./pages/VideoPlayer'), 'video-player');

function AppContent() {
    const {
        videos,
        loading,
        isSearchMode,
        searchTerm,
        handleSearch,
        resetSearch
    } = useVideo();

    const { collections } = useCollection();

    const {
        activeDownloads,
        queuedDownloads,
        handleVideoSubmit,
        showBilibiliPartsModal,
        setShowBilibiliPartsModal,
        bilibiliPartsInfo,
        isCheckingParts,
        handleDownloadAllBilibiliParts,
        handleDownloadCurrentBilibiliPart
    } = useDownload();

    const { isAuthenticated, loginRequired, checkingAuth } = useAuth();
    const { data: settings } = useSettings();

    useEffect(() => {
        if (settings?.websiteName) {
            document.title = settings.websiteName;
        } else {
            document.title = "MyTube - My Videos, My Rules.";
        }
    }, [settings?.websiteName]);



    return (
        <>
            {!isAuthenticated && loginRequired ? (
                checkingAuth ? (
                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            minHeight: '100vh',
                            bgcolor: 'background.default'
                        }}
                    >
                        <CircularProgress size={48} />
                    </Box>
                ) : (
                    <Suspense fallback={
                        <Box
                            sx={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                minHeight: '100vh',
                                bgcolor: 'background.default'
                            }}
                        >
                            <CircularProgress size={48} />
                        </Box>
                    }>
                        <LoginPage />
                    </Suspense>
                )
            ) : (
                <Router>
                    <PageTagFilterProvider>
                        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
                            <Header
                            onSearch={handleSearch}
                            onSubmit={handleVideoSubmit}
                            activeDownloads={activeDownloads}
                            queuedDownloads={queuedDownloads}
                            isSearchMode={isSearchMode}
                            searchTerm={searchTerm}
                            onResetSearch={resetSearch}

                            collections={collections}
                            videos={videos}
                        />

                        {/* Bilibili Parts Modal */}
                        <Suspense fallback={null}>
                            {showBilibiliPartsModal && (
                                <BilibiliPartsModal
                                    isOpen={showBilibiliPartsModal}
                                    onClose={() => setShowBilibiliPartsModal(false)}
                                    videosNumber={bilibiliPartsInfo.videosNumber}
                                    videoTitle={bilibiliPartsInfo.title}
                                    onDownloadAll={handleDownloadAllBilibiliParts}
                                    onDownloadCurrent={handleDownloadCurrentBilibiliPart}
                                    isLoading={loading || isCheckingParts}
                                    type={bilibiliPartsInfo.type}
                                />
                            )}
                        </Suspense>

                        <Box component="main" sx={{ flexGrow: 1, p: 0, width: '100%', overflowX: 'hidden' }}>
                            <Suspense fallback={
                                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                                    <CircularProgress />
                                </Box>
                            }>
                                <Routes>
                                    <Route path="/" element={<Home />} />
                                    <Route path="/search" element={<SearchPage />} />
                                    <Route path="/manage" element={<ManagePage />} />
                                    <Route path="/settings" element={<SettingsPage />} />
                                    <Route path="/downloads" element={<DownloadPage />} />
                                    <Route path="/collection/:id" element={<CollectionPage />} />
                                    <Route path="/author/:authorName" element={<AuthorVideos />} />
                                    <Route path="/video/:id" element={<VideoPlayer />} />
                                    <Route path="/subscriptions" element={<SubscriptionsPage />} />
                                    <Route path="/instruction" element={<InstructionPage />} />
                                </Routes>
                            </Suspense>
                        </Box>

                            <Footer />
                        </Box>
                    </PageTagFilterProvider>
                </Router>
            )}
        </>
    );
}

// Configure QueryClient with memory management settings
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            ...defaultQueryConfig,
            // Keep unused data in cache for 10 minutes before garbage collection
            gcTime: 10 * 60 * 1000,
            // Refetch on window focus only if data is stale
            refetchOnWindowFocus: false,
            // Don't refetch on reconnect by default
            refetchOnReconnect: false,
        },
    },
});

function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <ThemeContextProvider>
                <LanguageProvider>
                    <SnackbarProvider>
                        <AuthProvider>
                            <VideoProvider>
                                <CollectionProvider>
                                    <DownloadProvider>
                                        <AppContent />
                                    </DownloadProvider>
                                </CollectionProvider>
                            </VideoProvider>
                        </AuthProvider>
                    </SnackbarProvider>
                </LanguageProvider>
            </ThemeContextProvider>
        </QueryClientProvider>
    );
}

export default App;
