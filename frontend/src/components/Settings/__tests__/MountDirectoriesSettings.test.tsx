import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import MountDirectoriesSettings from '../MountDirectoriesSettings';

// Mock language context: t echoes the key. createTranslateOrFallback then
// returns the *fallback* when the key matches, so assertions check fallbacks.
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Mock the scan API so the mutation doesn't hit the network
vi.mock('../../../utils/apiClient', () => ({
    api: { post: vi.fn().mockResolvedValue({ data: { addedCount: 0, deletedCount: 0 } }) },
    getApiErrorMessage: vi.fn().mockResolvedValue('err'),
}));

const renderWithClient = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

describe('MountDirectoriesSettings', () => {
    const baseProps = {
        mountDirectories: '',
        onChange: vi.fn(),
        canUseHostAdminFeatures: true,
        settings: { mountDirectories: '' } as any,
        setSettings: vi.fn(),
        saveMutation: { isPending: false, mutate: vi.fn() },
        onShowDetails: vi.fn(),
        detailsButtonAriaLabel: 'Details',
        setMessage: vi.fn(),
    };

    it('renders the textarea and scan button when host admin features are allowed', () => {
        renderWithClient(<MountDirectoriesSettings {...baseProps} />);

        expect(screen.getByText('mountDirectories')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toBeInTheDocument();
        // t echoes the key 'scanFiles', and `t('scanFiles') || 'Scan Files'`
        // short-circuits to the echoed key.
        expect(screen.getByRole('button', { name: /scanFiles/ })).toBeInTheDocument();
    });

    it('renders a policy notice when host admin features are not allowed', () => {
        renderWithClient(<MountDirectoriesSettings {...baseProps} canUseHostAdminFeatures={false} />);

        expect(screen.getByText('Mount directories require host-level admin trust.')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('propagates textarea changes through onChange', async () => {
        const user = userEvent.setup();
        renderWithClient(<MountDirectoriesSettings {...baseProps} />);

        // The textarea is a controlled input bound to the `mountDirectories`
        // prop; since the test passes a static prop, each keystroke reports the
        // newly-entered character. A single char is the clearest signal.
        await user.type(screen.getByRole('textbox'), '/');

        expect(baseProps.onChange).toHaveBeenCalledWith('mountDirectories', '/');
    });

    it('shows an error message and does not scan when directories are empty', async () => {
        const user = userEvent.setup();
        renderWithClient(<MountDirectoriesSettings {...baseProps} mountDirectories="" />);

        await user.click(screen.getByRole('button', { name: /scanFiles/ }));

        expect(baseProps.setMessage).toHaveBeenCalledWith({ text: 'mountDirectoriesEmptyError', type: 'error' });
    });
});
