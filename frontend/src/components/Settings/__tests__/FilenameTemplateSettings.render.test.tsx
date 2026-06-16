import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FilenameTemplateSettings from '../FilenameTemplateSettings';
import { api } from '../../../utils/apiClient';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../utils/apiClient', () => ({
    api: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

const createTestQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

const render = (ui: React.ReactElement) => {
    const queryClient = createTestQueryClient();
    return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

describe('FilenameTemplateSettings information section', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.get).mockResolvedValue({
            data: {
                presets: [
                    {
                        id: 'legacy',
                        kind: 'legacy',
                        labelKey: 'filenamePresetLegacy',
                        descriptionKey: 'filenamePresetLegacy',
                        template: '{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}',
                        examplePath: 'Sample Video-Sample Channel-2026.mp4',
                        recommendedSourceTypes: ['channel', 'playlist', 'single'],
                    },
                ],
                deprecatedPresetAliases: [],
                informationNotes: [
                    { id: 'liquid', textKey: 'filenameRefInfoLiquid' },
                    { id: 'extension', textKey: 'filenameRefInfoExtension' },
                ],
                referenceSections: [
                    {
                        id: 'source',
                        titleKey: 'filenameRefSectionSourceTitle',
                        items: [
                            {
                                key: 'source_custom_name',
                                token: '{{ source_custom_name }}',
                                descriptionKey: 'filenameRefItemSourceCustomNameDesc',
                                example: 'Sample Channel',
                                kind: 'liquid',
                            },
                        ],
                    },
                ],
            },
        } as any);
        vi.mocked(api.post).mockResolvedValue({
            data: {
                valid: true,
                errors: [],
                resolved: {
                    mode: 'template',
                    matchedPresetId: 'custom',
                    template: '{{ title }}.{{ ext }}',
                },
                previews: {
                    channel: {
                        videoPath: 'Sample Video.mp4',
                        thumbnailPath: 'Sample Video.jpg',
                        subtitlePath: 'Sample Video.en.vtt',
                        warnings: [],
                    },
                    playlist: {
                        videoPath: 'Sample Playlist/Sample Video.mp4',
                        thumbnailPath: 'Sample Playlist/Sample Video.jpg',
                        subtitlePath: 'Sample Playlist/Sample Video.en.vtt',
                        warnings: [],
                    },
                    single: {
                        videoPath: 'Sample Video.mp4',
                        thumbnailPath: 'Sample Video.jpg',
                        subtitlePath: 'Sample Video.en.vtt',
                        warnings: [],
                    },
                },
            },
        } as any);
    });

    it('renders local reference content in the information section', async () => {
        const user = userEvent.setup();
        render(
            <FilenameTemplateSettings
                settings={{
                    downloadFilenameMode: 'template',
                    downloadFilenameTemplate: '{{ title }}.{{ ext }}',
                    mediaServerExportMode: 'off',
                } as any}
                onChange={vi.fn()}
            />
        );

        await user.click(screen.getByText('filenameRefInformationTitle'));

        expect(screen.getByText('filenameRefSectionSourceTitle')).toBeInTheDocument();
        expect(screen.getByText('{{ source_custom_name }}')).toBeInTheDocument();
        expect(screen.getByText('filenameRefInfoExtension')).toBeInTheDocument();
    });

    it('loads the catalog endpoint for reference data', async () => {
        render(
            <FilenameTemplateSettings
                settings={{
                    downloadFilenameMode: 'template',
                    downloadFilenameTemplate: '{{ title }}.{{ ext }}',
                    mediaServerExportMode: 'off',
                } as any}
                onChange={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith(
                '/settings/filename-template/preview',
                expect.any(Object)
            );
        });

        expect(api.get).toHaveBeenCalledWith('/settings/filename-template/catalog');
    });
});

describe('FilenameTemplateSettings preview tab grouping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.get).mockResolvedValue({
            data: {
                presets: [],
                deprecatedPresetAliases: [],
                informationNotes: [],
                referenceSections: [],
            },
        } as any);
    });

    const renderComponent = () =>
        render(
            <FilenameTemplateSettings
                settings={{
                    downloadFilenameMode: 'template',
                    downloadFilenameTemplate: '{{ title }}.{{ ext }}',
                    mediaServerExportMode: 'off',
                } as any}
                onChange={vi.fn()}
            />
        );

    const mockPreview = (
        previews: Record<'channel' | 'playlist' | 'single', { videoPath: string }>
    ) =>
        vi.mocked(api.post).mockResolvedValue({
            data: {
                valid: true,
                errors: [],
                resolved: {
                    mode: 'template',
                    matchedPresetId: 'custom',
                    template: '{{ title }}.{{ ext }}',
                },
                previews: {
                    channel: { ...previews.channel, warnings: [] },
                    playlist: { ...previews.playlist, warnings: [] },
                    single: { ...previews.single, warnings: [] },
                },
            },
        } as any);

    it('merges scenarios with identical paths and splits the one that differs', async () => {
        // Channel and Single render the same path; Playlist differs.
        mockPreview({
            channel: { videoPath: 'Sample Video.mp4' },
            playlist: { videoPath: 'Sample Playlist/Sample Video.mp4' },
            single: { videoPath: 'Sample Video.mp4' },
        });

        renderComponent();

        // The two identical scenarios collapse into a single combined tab.
        expect(
            await screen.findByRole('tab', { name: 'Channel / Single Video' })
        ).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Playlist' })).toBeInTheDocument();
        expect(screen.getAllByRole('tab')).toHaveLength(2);
    });

    it('renders no tabs when all scenarios are identical', async () => {
        mockPreview({
            channel: { videoPath: 'Sample Video.mp4' },
            playlist: { videoPath: 'Sample Video.mp4' },
            single: { videoPath: 'Sample Video.mp4' },
        });

        renderComponent();

        // The single preview line renders...
        expect(
            await screen.findByText(/filenamePreviewVideo:\s*Sample Video\.mp4/)
        ).toBeInTheDocument();
        // ...but no scenario tabs, since all three results are identical.
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });
});
