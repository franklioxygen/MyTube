import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SecuritySettings from '../SecuritySettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
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
        isPasswordSet: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render enable switch', () => {
        render(<SecuritySettings settings={defaultSettings} onChange={mockOnChange} />);

        expect(screen.getByLabelText('enableLogin')).toBeInTheDocument();
        expect(screen.queryByLabelText('password')).not.toBeInTheDocument();
    });

    it('should show password field when enabled', () => {
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true }} onChange={mockOnChange} />);

        expect(screen.getByLabelText('password')).toBeInTheDocument();
        expect(screen.getByText('passwordSetHelper')).toBeInTheDocument();
    });

    it('should handle switch change', async () => {
        const user = userEvent.setup();
        render(<SecuritySettings settings={defaultSettings} onChange={mockOnChange} />);

        await user.click(screen.getByLabelText('enableLogin'));
        expect(mockOnChange).toHaveBeenCalledWith('loginEnabled', true);
    });

    it('should handle password change', async () => {
        const user = userEvent.setup();
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true }} onChange={mockOnChange} />);

        const input = screen.getByLabelText('password');
        await user.type(input, 'secret');
        expect(mockOnChange).toHaveBeenCalledWith('password', 's');
    });
});
