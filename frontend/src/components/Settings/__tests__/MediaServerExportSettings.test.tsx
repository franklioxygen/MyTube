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

const baseSettings: Settings = {
    mediaServerExportMode: 'nfo',
    mediaServerLibraryPath: '/app/backend/uploads/media-library',
} as Settings;

function renderSettings(
    overrides: Partial<Settings> = {},
    onChange = vi.fn()
) {
    render(
        <MediaServerExportSettings
            settings={{ ...baseSettings, ...overrides }}
            onChange={onChange}
            recommendedTvLayout={false}
        />
    );
    return onChange;
}

describe('MediaServerExportSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('defaults to the adjacent layout and hides the managed-library controls', () => {
        renderSettings();

        expect(screen.getByLabelText('mediaServerExportLayout')).toHaveTextContent(
            'mediaServerExportLayoutAdjacent'
        );
        expect(
            screen.queryByText('mediaServerExportLayoutPlaylistTvDescription')
        ).not.toBeInTheDocument();
        expect(screen.queryByText('mediaServerCopyFallback')).not.toBeInTheDocument();
        expect(screen.queryByText('mediaServerLibraryPath')).not.toBeInTheDocument();
        // The filename-template warning still applies to adjacent sidecars.
        expect(
            screen.getByText('mediaServerExportRecommendedLayoutWarning')
        ).toBeInTheDocument();
    });

    it('offers both layouts and reports the selection', async () => {
        const user = userEvent.setup();
        const onChange = renderSettings();

        await user.click(screen.getByLabelText('mediaServerExportLayout'));
        const listbox = within(screen.getByRole('listbox'));
        expect(
            listbox.getByText('mediaServerExportLayoutAdjacent')
        ).toBeInTheDocument();
        await user.click(listbox.getByText('mediaServerExportLayoutPlaylistTv'));

        expect(onChange).toHaveBeenCalledWith('mediaServerExportLayout', 'playlist_tv');
    });

    it('explains the managed library and swaps the naming warning in playlist_tv', () => {
        renderSettings({ mediaServerExportLayout: 'playlist_tv' });

        expect(
            screen.getByText('mediaServerExportLayoutPlaylistTvDescription')
        ).toBeInTheDocument();
        expect(screen.getByText('mediaServerSeasonZeroHint')).toBeInTheDocument();
        expect(screen.getByText('mediaServerStableOrderHint')).toBeInTheDocument();
        expect(screen.getByText('mediaServerHardLinkHint')).toBeInTheDocument();
        expect(
            screen.getByText('/app/backend/uploads/media-library')
        ).toBeInTheDocument();
        expect(
            screen.getByText('mediaServerExportLayoutPlaylistTvNamingNote')
        ).toBeInTheDocument();
        expect(
            screen.queryByText('mediaServerExportRecommendedLayoutWarning')
        ).not.toBeInTheDocument();
    });

    it('defaults copy fallback to enabled and reports a change', async () => {
        const user = userEvent.setup();
        const onChange = renderSettings({ mediaServerExportLayout: 'playlist_tv' });

        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).toBeChecked();

        await user.click(checkbox);
        expect(onChange).toHaveBeenCalledWith('mediaServerCopyFallback', false);
    });

    it('sends the selected layout with the rebuild request', async () => {
        const user = userEvent.setup();
        vi.mocked(api.post).mockResolvedValue({
            data: {
                jobId: 'job-1',
                status: 'running',
                mode: 'nfo',
                layout: 'playlist_tv',
                action: 'rebuild',
                total: 0,
                processed: 0,
                succeeded: 0,
                skipped: 0,
                failed: 0,
            },
        } as any);
        renderSettings({ mediaServerExportLayout: 'playlist_tv' });

        await user.click(screen.getByRole('button', { name: 'mediaServerExportRebuild' }));
        expect(
            screen.getByText('mediaServerExportPlaylistTvRebuildConfirmBody')
        ).toBeInTheDocument();

        const dialog = within(screen.getByRole('dialog'));
        await user.click(dialog.getByRole('button', { name: 'mediaServerExportRebuild' }));

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

    it('shows the mirror summary, copy warning, and bounded failure details', async () => {
        const user = userEvent.setup();
        vi.mocked(api.post).mockResolvedValue({
            data: {
                jobId: 'job-2',
                status: 'completed',
                mode: 'nfo',
                layout: 'playlist_tv',
                action: 'rebuild',
                phase: 'completed',
                total: 3,
                processed: 3,
                succeeded: 2,
                skipped: 1,
                failed: 1,
                counts: {
                    shows: 1,
                    seasons: 2,
                    episodes: 3,
                    linkedMedia: 2,
                    copiedMedia: 1,
                    unchangedArtifacts: 0,
                    removedArtifacts: 4,
                },
            },
        } as any);
        renderSettings({ mediaServerExportLayout: 'playlist_tv' });

        await user.click(screen.getByRole('button', { name: 'mediaServerExportRebuild' }));
        const dialog = within(screen.getByRole('dialog'));
        await user.click(dialog.getByRole('button', { name: 'mediaServerExportRebuild' }));

        await waitFor(() => {
            expect(
                screen.getByText('mediaServerExportMirrorSummary')
            ).toBeInTheDocument();
        });
        expect(
            screen.getByText('mediaServerCopiedMediaWarning')
        ).toBeInTheDocument();
    });

    it('keeps the adjacent confirmation copy in adjacent layout', async () => {
        const user = userEvent.setup();
        renderSettings();

        await user.click(screen.getByRole('button', { name: 'mediaServerExportRebuild' }));

        expect(
            screen.getByText('mediaServerExportRebuildConfirmBody')
        ).toBeInTheDocument();
    });
});
