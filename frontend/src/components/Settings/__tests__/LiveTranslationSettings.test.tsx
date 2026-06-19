import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LiveTranslationSettings from '../LiveTranslationSettings';
import { Settings } from '../../../types';

// Mock language context: return the key (or key with vars) so assertions can
// match on translation keys directly.
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

const baseSettings = (overrides: Partial<Settings> = {}): Settings =>
    ({
        loginEnabled: false,
        defaultAutoPlay: false,
        defaultAutoLoop: false,
        maxConcurrentDownloads: 3,
        language: 'en',
        tags: [],
        cloudDriveEnabled: false,
        openListApiUrl: '',
        openListToken: '',
        cloudDrivePath: '',
        liveTranslationEnabled: false,
        liveTranslationModel: 'gemini-3.5-live-translate-preview',
        liveTranslationSourceLanguage: 'auto',
        liveTranslationTargetLanguage: 'en',
        ...overrides,
    }) as Settings;

interface RenderProps {
    settings?: Partial<Settings>;
    apiKeyConfigured?: boolean;
    apiKeyDraft?: string;
    clearApiKeyRequested?: boolean;
}

const renderComponent = (props: RenderProps = {}) => {
    const onChange = vi.fn();
    const onApiKeyDraftChange = vi.fn();
    const onClearApiKey = vi.fn();
    render(
        <LiveTranslationSettings
            settings={baseSettings(props.settings)}
            apiKeyConfigured={props.apiKeyConfigured ?? false}
            apiKeyDraft={props.apiKeyDraft ?? ''}
            clearApiKeyRequested={props.clearApiKeyRequested ?? false}
            onChange={onChange}
            onApiKeyDraftChange={onApiKeyDraftChange}
            onClearApiKey={onClearApiKey}
        />,
    );
    return { onChange, onApiKeyDraftChange, onClearApiKey };
};

describe('LiveTranslationSettings', () => {
    it('hides model/API/language fields when the feature is disabled', () => {
        renderComponent();
        expect(screen.getByRole('switch', { name: 'enableLiveTranslation' })).toBeInTheDocument();
        expect(screen.queryByLabelText('liveTranslationApiKey')).not.toBeInTheDocument();
        expect(screen.queryByText('liveTranslationModel')).not.toBeInTheDocument();
    });

    it('shows the fields when enabled', () => {
        renderComponent({ settings: { liveTranslationEnabled: true } });
        expect(screen.getByLabelText('liveTranslationApiKey')).toBeInTheDocument();
        expect(screen.getAllByText('liveTranslationModel').length).toBeGreaterThan(0);
        expect(screen.getAllByText('liveTranslationSourceLanguage').length).toBeGreaterThan(0);
        expect(screen.getAllByText('liveTranslationTargetLanguage').length).toBeGreaterThan(0);
    });

    it('toggles the feature via the switch', async () => {
        const user = userEvent.setup();
        const { onChange } = renderComponent();
        await user.click(screen.getByRole('switch', { name: 'enableLiveTranslation' }));
        expect(onChange).toHaveBeenCalledWith('liveTranslationEnabled', true);
    });

    it('never displays a stored secret; the input reflects only the draft', () => {
        renderComponent({
            settings: { liveTranslationEnabled: true },
            apiKeyConfigured: true,
            apiKeyDraft: '',
        });
        const input = screen.getByLabelText('liveTranslationApiKey') as HTMLInputElement;
        expect(input.value).toBe('');
        expect(input.getAttribute('type')).toBe('password');
        // Clear-key action is offered when a key is already configured.
        expect(screen.getByRole('button', { name: 'liveTranslationClearApiKey' })).toBeInTheDocument();
    });

    it('hides the clear button when no key is configured', () => {
        renderComponent({ settings: { liveTranslationEnabled: true }, apiKeyConfigured: false });
        expect(
            screen.queryByRole('button', { name: 'liveTranslationClearApiKey' }),
        ).not.toBeInTheDocument();
    });

    it('reports draft changes to the parent', async () => {
        const user = userEvent.setup();
        const { onApiKeyDraftChange } = renderComponent({
            settings: { liveTranslationEnabled: true },
        });
        await user.type(screen.getByLabelText('liveTranslationApiKey'), 'k');
        expect(onApiKeyDraftChange).toHaveBeenCalledWith('k');
    });
});
