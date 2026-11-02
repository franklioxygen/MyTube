import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DownloadsMenu from '../DownloadsMenu';

const mockNavigate = vi.fn();

vi.mock('react-router', () => ({
    useNavigate: () => mockNavigate,
}));

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

describe('DownloadsMenu', () => {
    const anchorEl = document.createElement('button');
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.appendChild(anchorEl);
        vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
        }));
    });

    afterEach(() => anchorEl.remove());

    it('keeps downloads navigation and opens subscriptions as a submenu', () => {
        render(
            <DownloadsMenu
                anchorEl={anchorEl}
                onClose={onClose}
                activeDownloads={[]}
                queuedDownloads={[]}
                hasActiveSubscriptions={true}
            />
        );

        fireEvent.click(screen.getByRole('menuitem', { name: /manageDownloads/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: /subscriptions/i }));

        expect(mockNavigate).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('menuitem', { name: 'allSubscriptions' }));

        expect(onClose).toHaveBeenCalledTimes(2);
        expect(mockNavigate).toHaveBeenNthCalledWith(1, '/downloads');
        expect(mockNavigate).toHaveBeenNthCalledWith(2, '/subscriptions');
    });

    it.each([
        ['authorSubscriptions', '/subscriptions?type=author'],
        ['playlistSubscriptions', '/subscriptions?type=playlist'],
    ])('opens %s from the subscription submenu', (label, url) => {
        render(<DownloadsMenu anchorEl={anchorEl} onClose={onClose} activeDownloads={[]} queuedDownloads={[]} />);
        fireEvent.click(screen.getByRole('menuitem', { name: 'subscriptions' }));
        fireEvent.click(screen.getByRole('menuitem', { name: label }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockNavigate).toHaveBeenCalledExactlyOnceWith(url);
    });

    it('supports arrow-key selection and activation without a mouse', async () => {
        const user = userEvent.setup();
        render(<DownloadsMenu anchorEl={anchorEl} onClose={onClose} activeDownloads={[]} queuedDownloads={[]} />);
        const trigger = screen.getByRole('menuitem', { name: 'subscriptions' });
        trigger.focus();
        await user.keyboard('{ArrowLeft}');
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'allSubscriptions' })).toHaveFocus());
        await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
        expect(mockNavigate).toHaveBeenCalledExactlyOnceWith('/subscriptions?type=playlist');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('preserves standard LTR desktop keys for opening and returning from the submenu', async () => {
        const user = userEvent.setup();
        render(<DownloadsMenu anchorEl={anchorEl} onClose={onClose} activeDownloads={[]} queuedDownloads={[]} />);
        const trigger = screen.getByRole('menuitem', { name: 'subscriptions' });
        trigger.focus();
        await user.keyboard('{ArrowRight}');
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'allSubscriptions' })).toHaveFocus());
        await user.keyboard('{ArrowLeft}');
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(onClose).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it.each(
        (['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const).flatMap((modifier) =>
            ['ArrowLeft', 'ArrowRight'].map((key) => ({ modifier, key })),
        ),
    )('leaves $modifier + $key available without opening or closing the submenu', async ({ modifier, key }) => {
        const user = userEvent.setup();
        render(<DownloadsMenu anchorEl={anchorEl} onClose={onClose} activeDownloads={[]} queuedDownloads={[]} />);
        const trigger = screen.getByRole('menuitem', { name: 'subscriptions' });
        trigger.focus();
        expect(fireEvent.keyDown(trigger, { key, [modifier]: true })).toBe(true);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveFocus();

        await user.click(trigger);
        const firstItem = screen.getByRole('menuitem', { name: 'allSubscriptions' });
        await waitFor(() => expect(firstItem).toHaveFocus());
        expect(fireEvent.keyDown(firstItem, { key, [modifier]: true })).toBe(true);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(firstItem).toHaveFocus();
        expect(onClose).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it.each(['ArrowLeft', 'ArrowRight'])('ignores held %s repeats while allowing a separate press to return', async (key) => {
        render(<DownloadsMenu anchorEl={anchorEl} onClose={onClose} activeDownloads={[]} queuedDownloads={[]} />);
        const trigger = screen.getByRole('menuitem', { name: 'subscriptions' });
        trigger.focus();
        expect(fireEvent.keyDown(trigger, { key, repeat: true })).toBe(true);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        fireEvent.keyDown(trigger, { key, repeat: false });
        const firstItem = screen.getByRole('menuitem', { name: 'allSubscriptions' });
        await waitFor(() => expect(firstItem).toHaveFocus());
        expect(fireEvent.keyDown(firstItem, { key, repeat: true })).toBe(true);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(firstItem).toHaveFocus();

        fireEvent.keyUp(firstItem, { key });
        fireEvent.keyDown(firstItem, { key, repeat: false });
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(onClose).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it.each(['Escape', 'ArrowRight'])('returns focus to the parent subscription item with %s', async (key) => {
        const user = userEvent.setup();
        render(<DownloadsMenu anchorEl={anchorEl} onClose={onClose} activeDownloads={[]} queuedDownloads={[]} />);
        const trigger = screen.getByRole('menuitem', { name: 'subscriptions' });
        await user.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await user.keyboard(`{${key}}`);
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(onClose).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it.each([
        ['ltr', false, 'ArrowLeft', 'ArrowRight'],
        ['rtl', false, 'ArrowLeft', 'ArrowRight'],
        ['ltr', true, 'ArrowRight', 'ArrowLeft'],
        ['rtl', true, 'ArrowLeft', 'ArrowRight'],
    ] as const)('uses matching open and return keys in %s layout (mobile: %s)', async (direction, mobile, openKey, closeKey) => {
        vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
            matches: mobile && query.includes('max-width'), media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
        }));
        const user = userEvent.setup();
        render(
            <ThemeProvider theme={createTheme({ direction })}>
                <DownloadsMenu anchorEl={anchorEl} onClose={onClose} activeDownloads={[]} queuedDownloads={[]} />
            </ThemeProvider>,
        );
        const trigger = screen.getByRole('menuitem', { name: 'subscriptions' });
        expect(trigger.querySelector(`[data-testid="${openKey === 'ArrowLeft' ? 'ChevronLeft' : 'ChevronRight'}Icon"]`)).toBeInTheDocument();
        trigger.focus();
        await user.keyboard(`{${openKey}}`);
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'allSubscriptions' })).toHaveFocus());
        await user.keyboard(`{${closeKey}}`);
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(onClose).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('closes the entire menu stack on Tab', async () => {
        const user = userEvent.setup();
        render(<DownloadsMenu anchorEl={anchorEl} onClose={onClose} activeDownloads={[]} queuedDownloads={[]} />);
        await user.click(screen.getByRole('menuitem', { name: 'subscriptions' }));
        await user.keyboard('{Tab}');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('renders active and queued download details', () => {
        render(
            <DownloadsMenu
                anchorEl={anchorEl}
                onClose={onClose}
                hasActiveSubscriptions={false}
                activeDownloads={[
                    {
                        id: 'active-1',
                        title: 'Active title',
                        filename: 'active-file.mp4',
                        progress: 42.34,
                        totalSize: '100 MB',
                        speed: '1.5 MB/s',
                    },
                    {
                        id: 'active-2',
                        title: 'Fallback title',
                    },
                ]}
                queuedDownloads={[
                    {
                        id: 'queued-1',
                        title: 'Queued title',
                    },
                ]}
            />
        );

        expect(screen.getByText('active-file.mp4')).toBeInTheDocument();
        expect(screen.getByText('42.3%')).toBeInTheDocument();
        expect(screen.getByText('100 MB')).toBeInTheDocument();
        expect(screen.getByText('1.5 MB/s')).toBeInTheDocument();

        expect(screen.getByText('Fallback title')).toBeInTheDocument();
        expect(screen.getByText('downloading')).toBeInTheDocument();

        expect(screen.getByText('queued (1)')).toBeInTheDocument();
        expect(screen.getByText('Queued title')).toBeInTheDocument();
        expect(screen.getByText('waitingInQueue')).toBeInTheDocument();
    });
});
