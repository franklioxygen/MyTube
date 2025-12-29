import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ConsoleManager from '../../../utils/consoleManager';
import AdvancedSettings from '../AdvancedSettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Mock ConsoleManager
vi.mock('../../../utils/consoleManager', () => ({
    default: {
        setDebugMode: vi.fn(),
    },
}));

describe('AdvancedSettings', () => {
    const defaultProps = {
        debugMode: false,
        onDebugModeChange: vi.fn(),
    };

    it('should render switch', () => {
        render(<AdvancedSettings {...defaultProps} />);
        expect(screen.getByText('debugModeDescription')).toBeInTheDocument();
        // Check for checkbox (Switch)
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
});
