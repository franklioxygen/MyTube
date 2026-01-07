import { Box, CircularProgress } from '@mui/material';
import { Suspense, lazy, useEffect } from 'react';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import './App.css';
import Footer from './components/Footer';
import Header from './components/Header';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CollectionProvider, useCollection } from './contexts/CollectionContext';
import { DownloadProvider, useDownload } from './contexts/DownloadContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { SnackbarProvider } from './contexts/SnackbarContext';
import { ThemeContextProvider } from './contexts/ThemeContext';
import { VideoProvider, useVideo } from './contexts/VideoContext';
import { useSettings } from './hooks/useSettings';
const BilibiliPartsModal = lazy(() => import('./components/BilibiliPartsModal'));
const AuthorVideos = lazy(() => import('./pages/AuthorVideos'));
const CollectionPage = lazy(() => import('./pages/CollectionPage'));
const DownloadPage = lazy(() => import('./pages/DownloadPage'));
const Home = lazy(() => import('./pages/Home'));
const InstructionPage = lazy(() => import('./pages/InstructionPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ManagePage = lazy(() => import('./pages/ManagePage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SubscriptionsPage = lazy(() => import('./pages/SubscriptionsPage'));
const VideoPlayer = lazy(() => import('./pages/VideoPlayer'));

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
                </Router>
            )}
        </>
    );
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Configure QueryClient with memory management settings
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Cache data for 5 minutes by default
            staleTime: 5 * 60 * 1000,
            // Keep unused data in cache for 10 minutes before garbage collection
            gcTime: 10 * 60 * 1000, // Previously called cacheTime
            // Retry failed requests 3 times instead of default
            retry: 3,
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
