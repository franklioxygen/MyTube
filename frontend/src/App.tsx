import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import './App.css';
import AnimatedRoutes from './components/AnimatedRoutes';
import BilibiliPartsModal from './components/BilibiliPartsModal';
import Footer from './components/Footer';
import Header from './components/Header';
import { CollectionProvider, useCollection } from './contexts/CollectionContext';
import { DownloadProvider, useDownload } from './contexts/DownloadContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { SnackbarProvider } from './contexts/SnackbarContext';
import { VideoProvider, useVideo } from './contexts/VideoContext';
import LoginPage from './pages/LoginPage';
import getTheme from './theme';

const API_URL = import.meta.env.VITE_API_URL;

function AppContent() {
    const {
        videos,
        loading,
        error,
        deleteVideo,
        isSearchMode,
        searchTerm,
        searchResults,
        localSearchResults,
        youtubeLoading,
        handleSearch,
        resetSearch,
        setIsSearchMode
    } = useVideo();

    const {
        collections,
        createCollection,
        addToCollection,
        removeFromCollection,
        deleteCollection
    } = useCollection();

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

    // Theme state
    const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
        return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    });

    // Login state
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [loginRequired, setLoginRequired] = useState<boolean>(true); // Assume required until checked
    const [checkingAuth, setCheckingAuth] = useState<boolean>(true);

    const theme = useMemo(() => getTheme(themeMode), [themeMode]);

    // Apply theme to body
    useEffect(() => {
        document.body.className = themeMode === 'light' ? 'light-mode' : '';
        localStorage.setItem('theme', themeMode);
    }, [themeMode]);

    const toggleTheme = () => {
        setThemeMode(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
    };

    // Check login settings and authentication status
    useEffect(() => {
        const checkAuth = async () => {
            try {
                // Check if login is enabled in settings
                const response = await axios.get(`${API_URL}/settings`);
                const { loginEnabled, isPasswordSet } = response.data;

                // Login is required only if enabled AND a password is set
                if (!loginEnabled || !isPasswordSet) {
                    setLoginRequired(false);
                    setIsAuthenticated(true);
                } else {
                    setLoginRequired(true);
                    // Check if already authenticated in this session
                    const sessionAuth = sessionStorage.getItem('mytube_authenticated');
                    if (sessionAuth === 'true') {
                        setIsAuthenticated(true);
                    } else {
                        setIsAuthenticated(false);
                    }
                }
            } catch (error) {
                console.error('Error checking auth settings:', error);
                // If error, default to requiring login for security, but maybe allow if backend is down?
                // Better to fail safe.
            } finally {
                setCheckingAuth(false);
            }
        };

        checkAuth();
    }, []);

    const handleLoginSuccess = () => {
        setIsAuthenticated(true);
        sessionStorage.setItem('mytube_authenticated', 'true');
    };

    const handleDownloadFromSearch = async (videoUrl: string) => {
        try {
            // We need to stop the search mode
            setIsSearchMode(false);

            const result = await handleVideoSubmit(videoUrl);
            return result;
        } catch (error) {
            console.error('Error in handleDownloadFromSearch:', error);
            return { success: false, error: 'Failed to download video' };
        }
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {!isAuthenticated && loginRequired ? (
                checkingAuth ? (
                    <div className="loading">Loading...</div>
                ) : (
                    <LoginPage onLoginSuccess={handleLoginSuccess} />
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

                        <Box component="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%', px: { xs: 1, md: 2, lg: 4 } }}>
                            <AnimatedRoutes
                                videos={videos}
                                loading={loading}
                                error={error}
                                onDeleteVideo={deleteVideo}
                                collections={collections}
                                isSearchMode={isSearchMode}
                                searchTerm={searchTerm}
                                localSearchResults={localSearchResults}
                                youtubeLoading={youtubeLoading}
                                searchResults={searchResults}
                                onDownload={handleDownloadFromSearch}
                                onResetSearch={resetSearch}
                                onAddToCollection={addToCollection}
                                onCreateCollection={createCollection}
                                onRemoveFromCollection={removeFromCollection}
                                onDeleteCollection={deleteCollection}
                            />
                        </Box>

                        <Footer />
                    </Box>
                </Router>
            )}
        </ThemeProvider>
    );
}

function App() {
    return (
        <LanguageProvider>
            <SnackbarProvider>
                <VideoProvider>
                    <CollectionProvider>
                        <DownloadProvider>
                            <AppContent />
                        </DownloadProvider>
                    </CollectionProvider>
                </VideoProvider>
            </SnackbarProvider>
        </LanguageProvider>
    );
}

export default App;
