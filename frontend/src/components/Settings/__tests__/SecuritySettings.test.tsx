import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SecuritySettings from '../SecuritySettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../utils/apiClient', () => ({
    api: {
        get: vi.fn().mockResolvedValue({ data: { exists: false } }),
        post: vi.fn(),
        delete: vi.fn(),
    },
}));

const createTestQueryClient = () => new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
        },
    },
});

const render = (ui: React.ReactElement) => {
    const queryClient = createTestQueryClient();
    return rtlRender(
        <QueryClientProvider client={queryClient}>
            {ui}
        </QueryClientProvider>
    );
};

describe('SecuritySettings', () => {
    const mockOnChange = vi.fn();
    const defaultSettings: any = {
        loginEnabled: false,
        password: '',
        apiKeyEnabled: false,
        apiKey: '',
        isPasswordSet: false,
        visitorPassword: '',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render enable switch', () => {
        render(<SecuritySettings settings={defaultSettings} onChange={mockOnChange} />);

        expect(screen.getByLabelText('enableLogin')).toBeInTheDocument();
        expect(screen.queryByLabelText('password')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('visitorPassword')).not.toBeInTheDocument();
    });

    it('should show password field when enabled', () => {
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true }} onChange={mockOnChange} />);

        expect(screen.getByLabelText('password')).toBeInTheDocument();
        expect(screen.getByLabelText('visitorPassword')).toBeInTheDocument();
        expect(screen.getByText('passwordSetHelper')).toBeInTheDocument();
    });

    it('should show visitor password field when login is enabled', () => {
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true }} onChange={mockOnChange} />);

        expect(screen.getByLabelText('visitorPassword')).toBeInTheDocument();
        expect(screen.getByText('visitorPasswordHelper')).toBeInTheDocument();
    });

    it('should handle switch change', async () => {
        const user = userEvent.setup();
        render(<SecuritySettings settings={defaultSettings} onChange={mockOnChange} />);

        await user.click(screen.getByLabelText('enableLogin'));
        expect(mockOnChange).toHaveBeenCalledWith('loginEnabled', true);
    });

    // Visitor mode switch has been removed - visitor password is always visible when login is enabled

    it('should handle password change', async () => {
        const user = userEvent.setup();
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true }} onChange={mockOnChange} />);

        const input = screen.getByLabelText('password');
        await user.type(input, 'secret');
        expect(mockOnChange).toHaveBeenCalledWith('password', 's');
    });

    it('should handle visitor password change', async () => {
        const user = userEvent.setup();
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true }} onChange={mockOnChange} />);

        const input = screen.getByLabelText('visitorPassword');
        await user.type(input, 'guest');
        expect(mockOnChange).toHaveBeenCalledWith('visitorPassword', 'g');
    });

    it('should show api key input and refresh button when enabled', () => {
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, apiKeyEnabled: true, apiKey: 'abc123' }}
                onChange={mockOnChange}
            />
        );

        expect(screen.getByLabelText('apiKey')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'refreshApiKey' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'copyApiKey' })).toBeInTheDocument();
    });

    it('should generate api key when enabling api key auth', async () => {
        const user = userEvent.setup();
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, apiKeyEnabled: false, apiKey: '' }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByLabelText('enableApiKeyAuth'));

        expect(mockOnChange).toHaveBeenCalledWith('apiKeyEnabled', true);
        expect(mockOnChange).toHaveBeenCalledWith('apiKey', expect.stringMatching(/^[a-f0-9]{64}$/));
    });

    it('should refresh api key value after confirming the modal', async () => {
        const user = userEvent.setup();
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, apiKeyEnabled: true, apiKey: 'abc123' }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByRole('button', { name: 'refreshApiKey' }));

        // Refresh now requires confirmation via a modal
        const confirmButton = screen.getByRole('button', { name: 'confirm' });
        await user.click(confirmButton);

        expect(mockOnChange).toHaveBeenCalledWith('apiKey', expect.stringMatching(/^[a-f0-9]{64}$/));
    });

    // Visitor mode switch has been removed - this test is no longer applicable
});
