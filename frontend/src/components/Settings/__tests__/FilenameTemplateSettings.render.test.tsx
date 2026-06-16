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
        vi.mocked(api.post).mockResolvedValue({
            data: {
                videoPath: 'Sample Video.mp4',
                thumbnailPath: 'Sample Video.jpg',
                subtitlePath: 'Sample Video.en.vtt',
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

    it('does not call the presets endpoint for reference data', async () => {
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

        expect(api.get).not.toHaveBeenCalledWith('/settings/filename-template/presets');
    });
});
