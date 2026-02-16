import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ConsoleManager from '../../../utils/consoleManager';
import AdvancedSettings from '../AdvancedSettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string, vars?: Record<string, string>) => {
        if (vars) return `${key}:${JSON.stringify(vars)}`;
        return key;
    } }),
}));

// Mock ConsoleManager
vi.mock('../../../utils/consoleManager', () => ({
    default: {
        setDebugMode: vi.fn(),
    },
}));

// Mock api client
const mockPost = vi.fn();
vi.mock('../../../utils/apiClient', () => ({
    api: {
        post: (...args: any[]) => mockPost(...args),
    },
}));

describe('AdvancedSettings', () => {
    const defaultProps = {
        debugMode: false,
        onDebugModeChange: vi.fn(),
        onChange: vi.fn(),
    };

    it('should render debug mode switch', () => {
        render(<AdvancedSettings {...defaultProps} />);
        expect(screen.getByText('debugModeDescription')).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'debugMode' })).toBeInTheDocument();
    });

    it('should reflect checked state', () => {
        render(<AdvancedSettings {...defaultProps} debugMode={true} />);
        expect(screen.getByRole('switch', { name: 'debugMode' })).toBeChecked();
    });

    it('should call onChange and setDebugMode when clicked', async () => {
        const user = userEvent.setup();
        render(<AdvancedSettings {...defaultProps} />);

        const switchControl = screen.getByRole('switch', { name: 'debugMode' });
        await user.click(switchControl);

        expect(defaultProps.onDebugModeChange).toHaveBeenCalledWith(true);
        expect(ConsoleManager.setDebugMode).toHaveBeenCalledWith(true);
    });

    describe('Telegram Notifications', () => {
        it('should render telegram section', () => {
            render(<AdvancedSettings {...defaultProps} />);
            expect(screen.getByText('telegramNotifications')).toBeInTheDocument();
            expect(screen.getByText('telegramNotificationsDescription')).toBeInTheDocument();
        });

        it('should render telegram enable toggle', () => {
            render(<AdvancedSettings {...defaultProps} />);
            expect(screen.getByRole('switch', { name: 'telegramEnabled' })).toBeInTheDocument();
        });

        it('should disable fields when telegram is disabled', () => {
            render(<AdvancedSettings {...defaultProps} telegramEnabled={false} />);
            const botTokenInput = screen.getByLabelText('telegramBotToken');
            const chatIdInput = screen.getByLabelText('telegramChatId');
            expect(botTokenInput).toBeDisabled();
            expect(chatIdInput).toBeDisabled();
        });

        it('should enable fields when telegram is enabled', () => {
            render(<AdvancedSettings {...defaultProps} telegramEnabled={true} />);
            const botTokenInput = screen.getByLabelText('telegramBotToken');
            const chatIdInput = screen.getByLabelText('telegramChatId');
            expect(botTokenInput).not.toBeDisabled();
            expect(chatIdInput).not.toBeDisabled();
        });

        it('should call onChange when toggling telegram enabled', async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<AdvancedSettings {...defaultProps} onChange={onChange} />);

            const toggle = screen.getByRole('switch', { name: 'telegramEnabled' });
            await user.click(toggle);

            expect(onChange).toHaveBeenCalledWith('telegramEnabled', true);
        });

        it('should call onChange when typing bot token', async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<AdvancedSettings {...defaultProps} telegramEnabled={true} onChange={onChange} />);

            const botTokenInput = screen.getByLabelText('telegramBotToken');
            await user.type(botTokenInput, 'a');

            expect(onChange).toHaveBeenCalledWith('telegramBotToken', 'a');
        });

        it('should call onChange when typing chat ID', async () => {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<AdvancedSettings {...defaultProps} telegramEnabled={true} onChange={onChange} />);

            const chatIdInput = screen.getByLabelText('telegramChatId');
            await user.type(chatIdInput, '1');

            expect(onChange).toHaveBeenCalledWith('telegramChatId', '1');
        });

        it('should show notify on success and fail toggles', () => {
            render(<AdvancedSettings {...defaultProps} telegramEnabled={true} />);
            expect(screen.getByRole('switch', { name: 'telegramNotifyOnSuccess' })).toBeInTheDocument();
            expect(screen.getByRole('switch', { name: 'telegramNotifyOnFail' })).toBeInTheDocument();
        });

        it('should have notify toggles checked by default', () => {
            render(<AdvancedSettings {...defaultProps} telegramEnabled={true} />);
            expect(screen.getByRole('switch', { name: 'telegramNotifyOnSuccess' })).toBeChecked();
            expect(screen.getByRole('switch', { name: 'telegramNotifyOnFail' })).toBeChecked();
        });

        it('should render test button', () => {
            render(<AdvancedSettings {...defaultProps} telegramEnabled={true} telegramBotToken="token" telegramChatId="123" />);
            const button = screen.getByRole('button', { name: 'telegramTestButton' });
            expect(button).toBeInTheDocument();
            expect(button).not.toBeDisabled();
        });

        it('should disable test button when token or chatId is missing', () => {
            render(<AdvancedSettings {...defaultProps} telegramEnabled={true} telegramBotToken="" telegramChatId="" />);
            const button = screen.getByRole('button', { name: 'telegramTestButton' });
            expect(button).toBeDisabled();
        });

        it('should disable test button when telegram is disabled', () => {
            render(<AdvancedSettings {...defaultProps} telegramEnabled={false} telegramBotToken="token" telegramChatId="123" />);
            const button = screen.getByRole('button', { name: 'telegramTestButton' });
            expect(button).toBeDisabled();
        });

        it('should show success alert on successful test', async () => {
            const user = userEvent.setup();
            mockPost.mockResolvedValue({ data: { success: true } });
            render(<AdvancedSettings {...defaultProps} telegramEnabled={true} telegramBotToken="token" telegramChatId="123" />);

            const button = screen.getByRole('button', { name: 'telegramTestButton' });
            await user.click(button);

            await waitFor(() => {
                expect(screen.getByText('telegramTestSuccess')).toBeInTheDocument();
            });
        });

        it('should show error alert on failed test', async () => {
            const user = userEvent.setup();
            mockPost.mockRejectedValue({
                response: { data: { error: 'chat not found' } },
                message: 'Request failed',
            });
            render(<AdvancedSettings {...defaultProps} telegramEnabled={true} telegramBotToken="token" telegramChatId="123" />);

            const button = screen.getByRole('button', { name: 'telegramTestButton' });
            await user.click(button);

            await waitFor(() => {
                expect(screen.getByRole('alert')).toBeInTheDocument();
            });
        });
    });
});
