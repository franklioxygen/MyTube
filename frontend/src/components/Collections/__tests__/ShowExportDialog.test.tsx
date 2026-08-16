import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShowExportDialog from '../ShowExportDialog';
import { Collection } from '../../../types';
import { api } from '../../../utils/apiClient';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../utils/apiClient', () => ({
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

function collection(overrides: Partial<Collection> = {}): Collection {
    return {
        id: 'c1',
        name: '人民的名义超高清版',
        title: '人民的名义超高清版',
        videos: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    } as Collection;
}

function renderDialog(overrides: Partial<Collection> = {}) {
    const onActivated = vi.fn();
    const onClose = vi.fn();
    render(
        <ShowExportDialog
            open
            collection={collection(overrides)}
            onClose={onClose}
            onActivated={onActivated}
        />
    );
    return { onActivated, onClose };
}

function candidate(overrides = {}) {
    return {
        tmdbId: 72517,
        mediaType: 'tv',
        title: '人民的名义',
        overview: 'Anti-corruption drama.',
        premiereDate: '2017-03-28',
        highConfidence: true,
        ...overrides,
    };
}

describe('ShowExportDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.put).mockResolvedValue({
            data: { collection: collection(), posterWarning: false },
        } as never);
    });

    describe('search', () => {
        it('seeds the query from the collection title', () => {
            renderDialog();

            expect(
                (screen.getByLabelText('collectionShowSearchLabel') as HTMLInputElement)
                    .value
            ).toBe('人民的名义超高清版');
        });

        it('renders candidates with their media type', async () => {
            const user = userEvent.setup();
            vi.mocked(api.post).mockResolvedValue({
                data: { status: 'ok', candidates: [candidate()] },
            } as never);
            renderDialog();

            await user.click(screen.getByRole('button', { name: 'collectionShowSearchAction' }));

            expect(await screen.findByText('人民的名义')).toBeTruthy();
            expect(screen.getByText('collectionShowMediaTypeTv')).toBeTruthy();
        });

        /**
         * A low-confidence result is still selectable — the design ranks and
         * labels, it never auto-applies — but it must be visibly a suggestion.
         */
        it('labels a low-confidence candidate as a suggestion', async () => {
            const user = userEvent.setup();
            vi.mocked(api.post).mockResolvedValue({
                data: {
                    status: 'ok',
                    candidates: [candidate({ highConfidence: false })],
                },
            } as never);
            renderDialog();

            await user.click(screen.getByRole('button', { name: 'collectionShowSearchAction' }));

            expect(await screen.findByText('collectionShowSuggestion')).toBeTruthy();
        });

        it('does not label a high-confidence candidate', async () => {
            const user = userEvent.setup();
            vi.mocked(api.post).mockResolvedValue({
                data: { status: 'ok', candidates: [candidate()] },
            } as never);
            renderDialog();

            await user.click(screen.getByRole('button', { name: 'collectionShowSearchAction' }));
            await screen.findByText('人民的名义');

            expect(screen.queryByText('collectionShowSuggestion')).toBeNull();
        });

        it('explains a missing credential while keeping the other modes usable', async () => {
            const user = userEvent.setup();
            vi.mocked(api.post).mockResolvedValue({
                data: { status: 'no_credential', candidates: [] },
            } as never);
            renderDialog();

            await user.click(screen.getByRole('button', { name: 'collectionShowSearchAction' }));

            expect(await screen.findByText('collectionShowNoCredential')).toBeTruthy();
            expect(
                screen.getByRole('button', { name: 'collectionShowUseCollectionMetadata' })
            ).toBeEnabled();
            expect(screen.getByLabelText('collectionShowManualLabel')).toBeEnabled();
        });

        it('reports an empty result set', async () => {
            const user = userEvent.setup();
            vi.mocked(api.post).mockResolvedValue({
                data: { status: 'no_results', candidates: [] },
            } as never);
            renderDialog();

            await user.click(screen.getByRole('button', { name: 'collectionShowSearchAction' }));

            expect(await screen.findByText('collectionShowNoResults')).toBeTruthy();
        });
    });

    describe('promotion warning', () => {
        it('warns when the collection is already a season', () => {
            renderDialog({ mediaServerSeasonNumber: 1 });

            expect(screen.getByText('collectionShowPromotionWarning')).toBeTruthy();
        });

        it('omits the warning for a collection that is not a season', () => {
            renderDialog();

            expect(screen.queryByText('collectionShowPromotionWarning')).toBeNull();
        });
    });

    describe('confirmation', () => {
        it('sends only the id and media type for a TMDB selection', async () => {
            const user = userEvent.setup();
            vi.mocked(api.post).mockResolvedValue({
                data: { status: 'ok', candidates: [candidate()] },
            } as never);
            renderDialog();

            await user.click(screen.getByRole('button', { name: 'collectionShowSearchAction' }));
            await user.click(await screen.findByText('人民的名义'));
            await user.click(screen.getByRole('button', { name: 'collectionShowConfirm' }));

            await waitFor(() => {
                expect(api.put).toHaveBeenCalledWith('/collections/c1/show-export', {
                    enabled: true,
                    mode: 'tmdb',
                    tmdbId: 72517,
                    mediaType: 'tv',
                });
            });
        });

        it('sends a trimmed manual title', async () => {
            const user = userEvent.setup();
            renderDialog();

            await user.type(screen.getByLabelText('collectionShowManualLabel'), '  My Drama  ');
            await user.click(screen.getByRole('button', { name: 'collectionShowConfirm' }));

            await waitFor(() => {
                expect(api.put).toHaveBeenCalledWith('/collections/c1/show-export', {
                    enabled: true,
                    mode: 'manual',
                    title: 'My Drama',
                });
            });
        });

        it('sends the collection mode without any metadata', async () => {
            const user = userEvent.setup();
            renderDialog();

            await user.click(
                screen.getByRole('button', { name: 'collectionShowUseCollectionMetadata' })
            );

            await waitFor(() => {
                expect(api.put).toHaveBeenCalledWith('/collections/c1/show-export', {
                    enabled: true,
                    mode: 'collection',
                });
            });
        });

        it('disables confirmation until something is chosen', () => {
            renderDialog();

            expect(
                screen.getByRole('button', { name: 'collectionShowConfirm' })
            ).toBeDisabled();
        });

        it('shows the proposed folder name before confirming', () => {
            renderDialog();

            expect(screen.getByText(/collectionShowFolderNotice/)).toBeTruthy();
        });

        it('surfaces a busy maintenance lock as a retryable message', async () => {
            const user = userEvent.setup();
            vi.mocked(api.put).mockRejectedValue({
                response: { data: { code: 'lock_unavailable' } },
            });
            renderDialog();

            await user.click(
                screen.getByRole('button', { name: 'collectionShowUseCollectionMetadata' })
            );

            expect(await screen.findByText('collectionShowLockBusy')).toBeTruthy();
        });

        it('surfaces a wrong-layout rejection', async () => {
            const user = userEvent.setup();
            vi.mocked(api.put).mockRejectedValue({
                response: { data: { code: 'layout_not_playlist_tv' } },
            });
            renderDialog();

            await user.click(
                screen.getByRole('button', { name: 'collectionShowUseCollectionMetadata' })
            );

            expect(await screen.findByText('collectionShowWrongLayout')).toBeTruthy();
        });
    });
});
