import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AnimatedRoutes from '../AnimatedRoutes';

// Mock all page components to avoid deep rendering headers
vi.mock('../../pages/Home', () => ({ default: () => <div data-testid="home-page">Home Page</div> }));
vi.mock('../../pages/CollectionPage', () => ({ default: () => <div data-testid="collection-page">Collection Page</div> }));
vi.mock('../../pages/VideoPlayer', () => ({ default: () => <div data-testid="video-player-page">Video Player Page</div> }));
vi.mock('../../pages/AuthorVideos', () => ({ default: () => <div data-testid="author-videos-page">Author Videos Page</div> }));
vi.mock('../../pages/DownloadPage', () => ({ default: () => <div data-testid="download-page">Download Page</div> }));
vi.mock('../../pages/SettingsPage', () => ({ default: () => <div data-testid="settings-page">Settings Page</div> }));
vi.mock('../../pages/ManagePage', () => ({ default: () => <div data-testid="manage-page">Manage Page</div> }));
vi.mock('../../pages/SearchResults', () => ({ default: () => <div data-testid="search-results-page">Search Results Page</div> }));
vi.mock('../../pages/LoginPage', () => ({ default: () => <div data-testid="login-page">Login Page</div> }));

describe('AnimatedRoutes', () => {
    it('should render Home page on root route', () => {
        render(
            <MemoryRouter initialEntries={['/']}>
                <AnimatedRoutes />
            </MemoryRouter>
        );
        expect(screen.getByTestId('home-page')).toBeInTheDocument();
    });

    it('should render CollectionPage on /collection/:id', () => {
        render(
            <MemoryRouter initialEntries={['/collection/123']}>
                <AnimatedRoutes />
            </MemoryRouter>
        );
        expect(screen.getByTestId('collection-page')).toBeInTheDocument();
    });

    it('should render VideoPlayer on /video/:id', () => {
        render(
            <MemoryRouter initialEntries={['/video/abc-123']}>
                <AnimatedRoutes />
            </MemoryRouter>
        );
        expect(screen.getByTestId('video-player-page')).toBeInTheDocument();
    });

    it('should render AuthorVideos on /author/:authorName', () => {
        render(
            <MemoryRouter initialEntries={['/author/john_doe']}>
                <AnimatedRoutes />
            </MemoryRouter>
        );
        expect(screen.getByTestId('author-videos-page')).toBeInTheDocument();
    });

    it('should render DownloadPage on /downloads', () => {
        render(
            <MemoryRouter initialEntries={['/downloads']}>
                <AnimatedRoutes />
            </MemoryRouter>
        );
        expect(screen.getByTestId('download-page')).toBeInTheDocument();
    });

    it('should render SettingsPage on /settings', () => {
        render(
            <MemoryRouter initialEntries={['/settings']}>
                <AnimatedRoutes />
            </MemoryRouter>
        );
        expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    });

    it('should render ManagePage on /manage', () => {
        render(
            <MemoryRouter initialEntries={['/manage']}>
                <AnimatedRoutes />
            </MemoryRouter>
        );
        expect(screen.getByTestId('manage-page')).toBeInTheDocument();
    });

    it('should render SearchResults on /search', () => {
        render(
            <MemoryRouter initialEntries={['/search']}>
                <AnimatedRoutes />
            </MemoryRouter>
        );
        expect(screen.getByTestId('search-results-page')).toBeInTheDocument();
    });

    it('should render LoginPage on /login', () => {
        render(
            <MemoryRouter initialEntries={['/login']}>
                <AnimatedRoutes />
            </MemoryRouter>
        );
        expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
});
