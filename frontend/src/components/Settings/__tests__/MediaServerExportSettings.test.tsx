import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MediaServerExportSettings from '../MediaServerExportSettings';
import { Settings } from '../../../types';
import { api } from '../../../utils/apiClient';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../utils/apiClient', () => ({
    api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../../hooks/useSettingsJobPolling', () => ({
    useSettingsJobPolling: vi.fn(),
}));

function renderSettings(
    overrides: Partial<Settings> = {},
    onChange = vi.fn(),
    recommendedTvLayout = true
) {
    const settings = {
        mediaServerExportMode: 'nfo',
        ...overrides,
    } as Settings;

    return {
        onChange,
        ...render(
            <MediaServerExportSettings
                settings={settings}
                onChange={onChange}
                recommendedTvLayout={recommendedTvLayout}
            />
        ),
    };
}

/**
 * Issue #411. The layout selector must always be discoverable, must default to
 * adjacent, and the playlist_tv-only explanations must not leak into adjacent.
 */
describe('MediaServerExportSettings layout selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('defaults to the adjacent layout when the setting is absent', () => {
        renderSettings();

        const layoutSelect = screen.getByLabelText('mediaServerExportLayout');
        expect(within(layoutSelect).getByText('mediaServerExportLayoutAdjacent')).toBeTruthy();
    });

    it('offers both layout options', async () => {
        const user = userEvent.setup();
        renderSettings();

        await user.click(screen.getByLabelText('mediaServerExportLayout'));

        expect(screen.getByRole('option', { name: 'mediaServerExportLayoutAdjacent' })).toBeTruthy();
        expect(
            screen.getByRole('option', { name: 'mediaServerExportLayoutPlaylistTv' })
        ).toBeTruthy();
    });

    it('reports the selected layout to the parent', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderSettings({}, onChange);

        await user.click(screen.getByLabelText('mediaServerExportLayout'));
        await user.click(
            screen.getByRole('option', { name: 'mediaServerExportLayoutPlaylistTv' })
        );

        expect(onChange).toHaveBeenCalledWith('mediaServerExportLayout', 'playlist_tv');
    });

    it('hides the playlist-TV explanations in adjacent layout', () => {
        renderSettings({ mediaServerExportLayout: 'adjacent' });

        expect(screen.queryByText('mediaServerExportLayoutPlaylistTvDescription')).toBeNull();
        expect(screen.queryByText('mediaServerSeasonZeroHint')).toBeNull();
        expect(screen.queryByText('mediaServerStableOrderHint')).toBeNull();
        expect(screen.queryByText('mediaServerCopyFallback')).toBeNull();
    });

    it('shows the playlist-TV explanations and copy fallback in that layout', () => {
        renderSettings({ mediaServerExportLayout: 'playlist_tv' });

        expect(screen.getByText('mediaServerExportLayoutPlaylistTvDescription')).toBeTruthy();
        expect(screen.getByText('mediaServerSeasonZeroHint')).toBeTruthy();
        expect(screen.getByText('mediaServerStableOrderHint')).toBeTruthy();
        expect(screen.getByText('mediaServerHardLinkHint')).toBeTruthy();
        expect(screen.getByLabelText('mediaServerCopyFallback')).toBeTruthy();
    });

    it('treats an absent copy fallback setting as enabled', () => {
        renderSettings({ mediaServerExportLayout: 'playlist_tv' });

        expect(
            (screen.getByLabelText('mediaServerCopyFallback') as HTMLInputElement).checked
        ).toBe(true);
    });

    it('reports a copy fallback change to the parent', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderSettings({ mediaServerExportLayout: 'playlist_tv' }, onChange);

        await user.click(screen.getByLabelText('mediaServerCopyFallback'));

        expect(onChange).toHaveBeenCalledWith('mediaServerCopyFallback', false);
    });

    it('shows the managed library path with a copy action', () => {
        renderSettings({
            mediaServerExportLayout: 'playlist_tv',
            mediaServerLibraryPath: '/app/backend/uploads/media-library',
        });

        expect(screen.getByText('/app/backend/uploads/media-library')).toBeTruthy();
        expect(screen.getByLabelText('copyLink')).toBeTruthy();
    });

    // Regression: a user picked this layout, saved, and nothing happened —
    // because the export mode was still Off, which makes the layout inert.
    it('warns that the layout is inactive while the export mode is off', () => {
        renderSettings({
            mediaServerExportMode: 'off',
            mediaServerExportLayout: 'playlist_tv',
        });

        expect(screen.getByText('mediaServerExportLayoutInactiveWarning')).toBeTruthy();
    });

    it('drops the inactive warning once an export mode is chosen', () => {
        renderSettings({
            mediaServerExportMode: 'nfo',
            mediaServerExportLayout: 'playlist_tv',
        });

        expect(screen.queryByText('mediaServerExportLayoutInactiveWarning')).toBeNull();
    });

    it('does not show the inactive warning for the adjacent layout', () => {
        renderSettings({
            mediaServerExportMode: 'off',
            mediaServerExportLayout: 'adjacent',
        });

        expect(screen.queryByText('mediaServerExportLayoutInactiveWarning')).toBeNull();
    });

    it('omits the path block when the server did not report one', () => {
        renderSettings({ mediaServerExportLayout: 'playlist_tv' });

        expect(screen.queryByText('mediaServerLibraryPath')).toBeNull();
    });
});

describe('MediaServerExportSettings template warning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('warns about a non-TV template in adjacent layout', () => {
        renderSettings({ mediaServerExportLayout: 'adjacent' }, vi.fn(), false);

        expect(screen.getByText('mediaServerExportRecommendedLayoutWarning')).toBeTruthy();
    });

    it('replaces the warning with a naming note in playlist-TV layout', () => {
        renderSettings({ mediaServerExportLayout: 'playlist_tv' }, vi.fn(), false);

        // The managed mirror builds its own structure, so the template warning
        // does not apply there.
        expect(screen.queryByText('mediaServerExportRecommendedLayoutWarning')).toBeNull();
        expect(screen.getByText('mediaServerExportLayoutPlaylistTvNamingNote')).toBeTruthy();
    });
});

describe('MediaServerExportSettings rebuild', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.post).mockResolvedValue({
            data: {
                jobId: 'job-1',
                status: 'running',
                total: 0,
                processed: 0,
                succeeded: 0,
                skipped: 0,
                failed: 0,
                action: 'rebuild',
                mode: 'nfo',
                layout: 'playlist_tv',
            },
        } as never);
    });

    it('sends the layout so the action cannot change after confirmation', async () => {
        const user = userEvent.setup();
        renderSettings({ mediaServerExportLayout: 'playlist_tv' });

        await user.click(screen.getByRole('button', { name: 'mediaServerExportRebuild' }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'mediaServerExportRebuild' }));

        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith(
                '/settings/media-server-export/rebuild',
                {
                    mediaServerExportMode: 'nfo',
                    mediaServerExportLayout: 'playlist_tv',
                }
            );
        });
    });

    it('adds the playlist-TV specific confirmation text', async () => {
        const user = userEvent.setup();
        renderSettings({ mediaServerExportLayout: 'playlist_tv' });

        await user.click(screen.getByRole('button', { name: 'mediaServerExportRebuild' }));
        const dialog = await screen.findByRole('dialog');

        expect(
            within(dialog).getByText('mediaServerExportPlaylistTvRebuildConfirmBody')
        ).toBeTruthy();
    });

    it('uses the cleanup wording for the playlist-TV mirror when the mode is off', async () => {
        const user = userEvent.setup();
        renderSettings({
            mediaServerExportMode: 'off',
            mediaServerExportLayout: 'playlist_tv',
        });

        await user.click(screen.getByRole('button', { name: 'mediaServerExportCleanup' }));
        const dialog = await screen.findByRole('dialog');

        expect(
            within(dialog).getByText('mediaServerExportPlaylistTvCleanupConfirmBody')
        ).toBeTruthy();
    });

    it('omits the playlist-TV confirmation text in adjacent layout', async () => {
        const user = userEvent.setup();
        renderSettings({ mediaServerExportLayout: 'adjacent' });

        await user.click(screen.getByRole('button', { name: 'mediaServerExportRebuild' }));
        const dialog = await screen.findByRole('dialog');

        expect(
            within(dialog).queryByText('mediaServerExportPlaylistTvRebuildConfirmBody')
        ).toBeNull();
    });
});
