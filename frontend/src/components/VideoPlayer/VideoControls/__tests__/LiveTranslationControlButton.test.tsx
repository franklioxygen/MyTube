import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import LiveTranslationControlButton from '../LiveTranslationControlButton';
import { useLiveTranslationControl } from '../../../../contexts/LiveTranslationContext';

vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../../contexts/LiveTranslationContext', () => ({
    useLiveTranslationControl: vi.fn(),
}));
vi.mock('@mui/material', async () => {
    const actual = await vi.importActual('@mui/material');
    return { ...actual, useMediaQuery: () => false };
});

const mockControl = useLiveTranslationControl as unknown as Mock;

function setControl(overrides: Record<string, unknown> = {}) {
    const onToggle = vi.fn();
    const retry = vi.fn();
    mockControl.mockReturnValue({
        shouldRender: true,
        status: 'idle',
        isActive: false,
        isConnecting: false,
        isPaused: false,
        disabledReason: null,
        targetAbbreviation: 'EN',
        targetLabel: 'English',
        onToggle,
        errorVisible: false,
        errorText: '',
        retryable: false,
        retry,
        ...overrides,
    });
    return { onToggle, retry };
}

describe('LiveTranslationControlButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when the feature should not render', () => {
        setControl({ shouldRender: false });
        const { container } = render(<LiveTranslationControlButton />);
        expect(container).toBeEmptyDOMElement();
    });

    it('starts the session when clicked while idle', async () => {
        const { onToggle } = setControl();
        render(<LiveTranslationControlButton />);
        const button = screen.getByRole('button', { name: 'liveTranslate' });
        expect(button).toBeEnabled();
        await userEvent.click(button);
        expect(onToggle).toHaveBeenCalled();
    });

    it('shows the target abbreviation and a pressed state when active', async () => {
        const { onToggle } = setControl({
            status: 'translating',
            isActive: true,
            targetAbbreviation: 'CN',
            targetLabel: 'Chinese (Simplified)',
        });
        render(<LiveTranslationControlButton />);
        const button = screen.getByRole('button', { name: 'stopLiveTranslation' });
        expect(button).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('CN')).toBeInTheDocument();
        await userEvent.click(button);
        expect(onToggle).toHaveBeenCalled();
    });

    it('disables the button when a disabled reason is present', () => {
        setControl({ disabledReason: 'liveTranslationAdminRequiredPlayer' });
        render(<LiveTranslationControlButton />);
        expect(screen.getByRole('button', { name: 'liveTranslate' })).toBeDisabled();
    });

    it('shows a progress indicator while connecting', () => {
        setControl({ status: 'connecting', isActive: true, isConnecting: true });
        render(<LiveTranslationControlButton />);
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
});
