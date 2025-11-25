import { AnimatePresence } from 'framer-motion';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AuthorVideos from '../pages/AuthorVideos';
import CollectionPage from '../pages/CollectionPage';
import Home from '../pages/Home';
import ManagePage from '../pages/ManagePage';
import SearchResults from '../pages/SearchResults';
import SettingsPage from '../pages/SettingsPage';
import VideoPlayer from '../pages/VideoPlayer';
import { Collection, Video } from '../types';
import PageTransition from './PageTransition';

interface AnimatedRoutesProps {
    videos: Video[];
    loading: boolean;
    error: string | null;
    onDeleteVideo: (id: string) => Promise<{ success: boolean; error?: string }>;
    collections: Collection[];
    isSearchMode: boolean;
    searchTerm: string;
    localSearchResults: Video[];
    youtubeLoading: boolean;
    searchResults: any[];
    onDownload: (videoUrl: string) => Promise<any>;
    onResetSearch: () => void;
    onAddToCollection: (collectionId: string, videoId: string) => Promise<any>;
    onCreateCollection: (name: string, videoId: string) => Promise<any>;
    onRemoveFromCollection: (videoId: string) => Promise<boolean>;
    onDeleteCollection: (collectionId: string, deleteVideos?: boolean) => Promise<{ success: boolean; error?: string }>;
}

const AnimatedRoutes = ({
    videos,
    loading,
    error,
    onDeleteVideo,
    collections,
    isSearchMode,
    searchTerm,
    localSearchResults,
    youtubeLoading,
    searchResults,
    onDownload,
    onResetSearch,
    onAddToCollection,
    onCreateCollection,
    onRemoveFromCollection,
    onDeleteCollection
}: AnimatedRoutesProps) => {
    const location = useLocation();

    return (
        <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
                <Route
                    path="/"
                    element={
                        <PageTransition>
                            <Home
                                videos={videos}
                                loading={loading}
                                error={error}
                                onDeleteVideo={onDeleteVideo}
                                collections={collections}
                                isSearchMode={isSearchMode}
                                searchTerm={searchTerm}
                                localSearchResults={localSearchResults}
                                youtubeLoading={youtubeLoading}
                                searchResults={searchResults}
                                onDownload={onDownload}
                                onResetSearch={onResetSearch}
                            />
                        </PageTransition>
                    }
                />
                <Route
                    path="/video/:id"
                    element={
                        <PageTransition>
                            <VideoPlayer
                                videos={videos}
                                onDeleteVideo={onDeleteVideo}
                                collections={collections}
                                onAddToCollection={onAddToCollection}
                                onCreateCollection={onCreateCollection}
                                onRemoveFromCollection={onRemoveFromCollection}
                            />
                        </PageTransition>
                    }
                />
                <Route
                    path="/author/:author"
                    element={
                        <PageTransition>
                            <AuthorVideos
                                videos={videos}
                                onDeleteVideo={onDeleteVideo}
                                collections={collections}
                            />
                        </PageTransition>
                    }
                />
                <Route
                    path="/collection/:id"
                    element={
                        <PageTransition>
                            <CollectionPage
                                collections={collections}
                                videos={videos}
                                onDeleteVideo={onDeleteVideo}
                                onDeleteCollection={onDeleteCollection}
                            />
                        </PageTransition>
                    }
                />
                <Route
                    path="/search"
                    element={
                        <PageTransition>
                            <SearchResults
                                results={searchResults}
                                localResults={localSearchResults}
                                youtubeLoading={youtubeLoading}
                                loading={loading}
                                onDownload={onDownload}
                                onResetSearch={onResetSearch}
                                onDeleteVideo={onDeleteVideo}
                                collections={collections}
                                searchTerm={searchTerm}
                            />
                        </PageTransition>
                    }
                />
                <Route
                    path="/manage"
                    element={
                        <PageTransition>
                            <ManagePage
                                videos={videos}
                                onDeleteVideo={onDeleteVideo}
                                collections={collections}
                                onDeleteCollection={onDeleteCollection}
                            />
                        </PageTransition>
                    }
                />
                <Route
                    path="/settings"
                    element={
                        <PageTransition>
                            <SettingsPage />
                        </PageTransition>
                    }
                />
                {/* Redirect /login to home if already authenticated (or login disabled) */}
                <Route path="/login" element={<Navigate to="/" replace />} />
                {/* Catch all - redirect to home */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </AnimatePresence>
    );
};

export default AnimatedRoutes;
