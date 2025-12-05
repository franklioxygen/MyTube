import { Box, CircularProgress, CssBaseline, ThemeProvider } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import './App.css';
import BilibiliPartsModal from './components/BilibiliPartsModal';
import Footer from './components/Footer';
import Header from './components/Header';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CollectionProvider, useCollection } from './contexts/CollectionContext';
import { DownloadProvider, useDownload } from './contexts/DownloadContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { SnackbarProvider } from './contexts/SnackbarContext';
import { VideoProvider, useVideo } from './contexts/VideoContext';
import AuthorVideos from './pages/AuthorVideos';
import CollectionPage from './pages/CollectionPage';
import DownloadPage from './pages/DownloadPage';
import Home from './pages/Home';
import InstructionPage from './pages/InstructionPage';
import LoginPage from './pages/LoginPage';
import ManagePage from './pages/ManagePage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import SubscriptionsPage from './pages/SubscriptionsPage';
import VideoPlayer from './pages/VideoPlayer';
import getTheme from './theme';

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

    // Theme state
    const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
        return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    });

    const theme = useMemo(() => getTheme(themeMode), [themeMode]);

    // Apply theme to body
    useEffect(() => {
        document.body.className = themeMode === 'light' ? 'light-mode' : '';
        localStorage.setItem('theme', themeMode);
    }, [themeMode]);

    const toggleTheme = () => {
        setThemeMode(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
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
                    <LoginPage />
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
                            theme={themeMode}
                            toggleTheme={toggleTheme}
                            collections={collections}
                            videos={videos}
                        />

                        {/* Bilibili Parts Modal */}
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

                        <Box component="main" sx={{ flexGrow: 1, p: 0, width: '100%', overflowX: 'hidden' }}>
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
                        </Box>

                        <Footer />
                    </Box>
                </Router>
            )}
        </ThemeProvider>
    );
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

function App() {
    return (
        <QueryClientProvider client={queryClient}>
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
        </QueryClientProvider>
    );
}

export default App;
