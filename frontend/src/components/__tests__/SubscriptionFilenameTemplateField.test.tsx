import { createTheme, ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import SubscriptionFilenameTemplateField from '../SubscriptionFilenameTemplateField';

// Mock LanguageContext — return the key verbatim so assertions can match keys.
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

const mockApiPost = vi.fn();

vi.mock('../../utils/apiClient', () => ({
    api: {
        post: (...args: any[]) => mockApiPost(...args),
    },
}));

/** Stateful wrapper so the controlled input actually updates on change. */
function FieldHarness(props: {
    initial?: string;
    sourceCollectionType?: 'channel' | 'playlist';
    onValidityChange?: (valid: boolean) => void;
}) {
    const [value, setValue] = useState(props.initial ?? '');
    return (
        <SubscriptionFilenameTemplateField
            value={value}
            onChange={setValue}
            sourceCollectionType={props.sourceCollectionType ?? 'channel'}
            onValidityChange={props.onValidityChange}
        />
    );
}

const renderField = (initial = '', sourceCollectionType: 'channel' | 'playlist' = 'channel') => {
    const theme = createTheme();
    return render(
        <ThemeProvider theme={theme}>
            <FieldHarness initial={initial} sourceCollectionType={sourceCollectionType} />
        </ThemeProvider>
    );
};

describe('SubscriptionFilenameTemplateField', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows the inherit helper when blank and reports validity true', () => {
        const onValidityChange = vi.fn();
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <FieldHarness onValidityChange={onValidityChange} />
            </ThemeProvider>
        );
        expect(screen.getByText('subscriptionFilenameTemplateInherit')).toBeInTheDocument();
        expect(onValidityChange).toHaveBeenLastCalledWith(true);
    });

    it('sends a debounced validation request with the given source collection type', async () => {
        mockApiPost.mockResolvedValue({
            data: {
                valid: true,
                errors: [],
                warnings: [],
                rendered: {
                    videoPath: 'Channel/Title.mp4',
                    thumbnailPath: 'Channel/Title.jpg',
                    subtitlePath: 'Channel/Title.en.vtt',
                },
            },
        });

        renderField('', 'playlist');
        await userEvent.type(screen.getByRole('textbox'), '{{ title }}.{{ ext }}');

        await waitFor(() => {
            expect(mockApiPost).toHaveBeenCalledWith(
                '/settings/filename-template/validate',
                expect.objectContaining({ sourceCollectionType: 'playlist' })
            );
        });
    });

    it('reports a non-empty template as invalid until server validation completes', async () => {
        let resolveValidation: ((value: unknown) => void) | undefined;
        mockApiPost.mockReturnValue(new Promise((resolve) => {
            resolveValidation = resolve;
        }));

        const onValidityChange = vi.fn();
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <FieldHarness onValidityChange={onValidityChange} />
            </ThemeProvider>
        );

        await userEvent.type(screen.getByRole('textbox'), '{{ title }}.{{ ext }}');
        await waitFor(() => {
            expect(mockApiPost).toHaveBeenCalledTimes(1);
        });
        expect(onValidityChange).toHaveBeenLastCalledWith(false);

        resolveValidation?.({
            data: {
                valid: true,
                errors: [],
                warnings: [],
                rendered: null,
            },
        });
        await waitFor(() => {
            expect(onValidityChange).toHaveBeenLastCalledWith(true);
        });
    });

    it('renders validation errors and reports validity false', async () => {
        mockApiPost.mockResolvedValue({
            data: {
                valid: false,
                errors: ['Missing extension placeholder'],
                warnings: [],
                rendered: null,
            },
        });

        const onValidityChange = vi.fn();
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <FieldHarness onValidityChange={onValidityChange} />
            </ThemeProvider>
        );
        await userEvent.type(screen.getByRole('textbox'), 'no-ext');

        await waitFor(() => {
            expect(screen.getByText('Missing extension placeholder')).toBeInTheDocument();
        });
        expect(onValidityChange).toHaveBeenLastCalledWith(false);
    });

    it('renders the preview when valid', async () => {
        mockApiPost.mockResolvedValue({
            data: {
                valid: true,
                errors: [],
                warnings: [],
                rendered: {
                    videoPath: 'Channel/Title.mp4',
                    thumbnailPath: 'Channel/Title.jpg',
                    subtitlePath: 'Channel/Title.en.vtt',
                },
            },
        });

        renderField();
        await userEvent.type(screen.getByRole('textbox'), '{{ title }}.{{ ext }}');

        await waitFor(() => {
            expect(screen.getByText('Channel/Title.mp4')).toBeInTheDocument();
        });
    });
});
