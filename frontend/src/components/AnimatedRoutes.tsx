import { AnimatePresence, motion } from 'framer-motion';
import React from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import AuthorVideos from '../pages/AuthorVideos';
import CollectionPage from '../pages/CollectionPage';
import DownloadPage from '../pages/DownloadPage';
import Home from '../pages/Home';
import LoginPage from '../pages/LoginPage';
import ManagePage from '../pages/ManagePage';
import SearchResults from '../pages/SearchResults';
import SettingsPage from '../pages/SettingsPage';
import VideoPlayer from '../pages/VideoPlayer';

const AnimatedRoutes: React.FC = () => {
    const location = useLocation();

    return (
        <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
                <Route
                    path="/"
                    element={
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            transition={{ duration: 0.3 }}
                        >
                            <Home />
                        </motion.div>
                    }
                />
                <Route
                    path="/collection/:id"
                    element={
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.3 }}
                        >
                            <CollectionPage />
                        </motion.div>
                    }
                />
                <Route
                    path="/video/:id"
                    element={
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.3 }}
                        >
                            <VideoPlayer />
                        </motion.div>
                    }
                />
                <Route
                    path="/author/:authorName"
                    element={
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.3 }}
                        >
                            <AuthorVideos />
                        </motion.div>
                    }
                />
                <Route
                    path="/downloads"
                    element={
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                        >
                            <DownloadPage />
                        </motion.div>
                    }
                />
                <Route
                    path="/settings"
                    element={
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                        >
                            <SettingsPage />
                        </motion.div>
                    }
                />
                <Route
                    path="/manage"
                    element={
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                        >
                            <ManagePage />
                        </motion.div>
                    }
                />
                <Route
                    path="/search"
                    element={
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <SearchResults />
                        </motion.div>
                    }
                />
                <Route
                    path="/login"
                    element={
                        <motion.div
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            transition={{ duration: 0.3 }}
                        >
                            <LoginPage />
                        </motion.div>
                    }
                />
            </Routes>
        </AnimatePresence>
    );
};

export default AnimatedRoutes;
