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
        visitorMode: false,
        visitorPassword: '',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render enable switch', () => {
        render(<SecuritySettings settings={defaultSettings} onChange={mockOnChange} />);

        expect(screen.getByLabelText('enableLogin')).toBeInTheDocument();
        expect(screen.queryByLabelText('visitorUser')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('password')).not.toBeInTheDocument();
    });

    it('should show password field when enabled', () => {
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true }} onChange={mockOnChange} />);

        expect(screen.getByLabelText('password')).toBeInTheDocument();
        expect(screen.getByLabelText('visitorUser')).toBeInTheDocument();
        expect(screen.getByText('passwordSetHelper')).toBeInTheDocument();
    });

    it('should show visitor password field when visitor mode is enabled', () => {
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true, visitorMode: true }} onChange={mockOnChange} />);

        expect(screen.getByLabelText('visitorPassword')).toBeInTheDocument();
        expect(screen.getByText('visitorPasswordHelper')).toBeInTheDocument();
    });

    it('should handle switch change', async () => {
        const user = userEvent.setup();
        render(<SecuritySettings settings={defaultSettings} onChange={mockOnChange} />);

        await user.click(screen.getByLabelText('enableLogin'));
        expect(mockOnChange).toHaveBeenCalledWith('loginEnabled', true);
    });

    it('should handle visitor switch change', async () => {
        const user = userEvent.setup();
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true }} onChange={mockOnChange} />);

        await user.click(screen.getByLabelText('visitorUser'));
        expect(mockOnChange).toHaveBeenCalledWith('visitorMode', true);
    });

    it('should handle password change', async () => {
        const user = userEvent.setup();
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true }} onChange={mockOnChange} />);

        const input = screen.getByLabelText('password');
        await user.type(input, 'secret');
        expect(mockOnChange).toHaveBeenCalledWith('password', 's');
    });

    it('should handle visitor password change', async () => {
        const user = userEvent.setup();
        render(<SecuritySettings settings={{ ...defaultSettings, loginEnabled: true, visitorMode: true }} onChange={mockOnChange} />);

        const input = screen.getByLabelText('visitorPassword');
        await user.type(input, 'guest');
        expect(mockOnChange).toHaveBeenCalledWith('visitorPassword', 'g');
    });

    it('should disable login enabled switch when visitor mode is enabled', () => {
        render(<SecuritySettings settings={{ ...defaultSettings, visitorMode: true, loginEnabled: true }} onChange={mockOnChange} />);

        const loginSwitch = screen.getByLabelText('enableLogin');
        expect(loginSwitch).toBeDisabled();
    });
});
