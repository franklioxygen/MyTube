import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SubtitleControl from '../SubtitleControl';

vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key })
}));

const subtitles = [
    { language: 'en', filename: 'sub.en.vtt', path: '/subs/sub.en.vtt' },
    { language: 'es', filename: 'sub.es.vtt', path: '/subs/sub.es.vtt' },
    { language: 'fr', filename: 'sub.fr.vtt', path: '/subs/sub.fr.vtt' }
];

const defaultProps = {
    subtitles,
    subtitlesEnabled: false,
    selectedSubtitleIndices: [] as number[],
    subtitleMenuAnchor: null,
    onSubtitleClick: vi.fn(),
    onCloseMenu: vi.fn(),
    onSelectSubtitle: vi.fn(),
    showOnMobile: false
};

const renderWithMenu = (overrides: Partial<typeof defaultProps> = {}) => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const props = { ...defaultProps, subtitleMenuAnchor: anchor, ...overrides };
    render(<SubtitleControl {...props} />);
    return { anchor, onSelectSubtitle: props.onSelectSubtitle };
};

describe('SubtitleControl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── basic rendering ────────────────────────────────────────────────────────

    it('renders the subtitle button when subtitles exist', () => {
        render(<SubtitleControl {...defaultProps} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('renders nothing when no subtitles and no upload handler', () => {
        render(<SubtitleControl {...defaultProps} subtitles={[]} />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders the button when no subtitles but onUploadSubtitle is provided', () => {
        render(<SubtitleControl {...defaultProps} subtitles={[]} onUploadSubtitle={vi.fn()} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('calls onSubtitleClick when the button is clicked', () => {
        render(<SubtitleControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        expect(defaultProps.onSubtitleClick).toHaveBeenCalled();
    });

    // ── menu items ─────────────────────────────────────────────────────────────

    it('shows a menu item for each subtitle when the menu is open', () => {
        renderWithMenu();
        expect(screen.getByText('English')).toBeInTheDocument();
        expect(screen.getByText('Spanish')).toBeInTheDocument();
        expect(screen.getByText('French')).toBeInTheDocument();
    });

    it('shows an "off" option when subtitles are available', () => {
        renderWithMenu();
        expect(screen.getByText('off')).toBeInTheDocument();
    });

    it('calls onSelectSubtitle(0) when the first subtitle is clicked', () => {
        const { onSelectSubtitle } = renderWithMenu();
        fireEvent.click(screen.getByText('English'));
        expect(onSelectSubtitle).toHaveBeenCalledWith(0);
    });

    it('calls onSelectSubtitle(-1) when "off" is clicked', () => {
        const { onSelectSubtitle } = renderWithMenu();
        fireEvent.click(screen.getByText('off'));
        expect(onSelectSubtitle).toHaveBeenCalledWith(-1);
    });

    it('shows the upload button when onUploadSubtitle is provided', () => {
        renderWithMenu({ onUploadSubtitle: vi.fn() });
        expect(screen.getByText('uploadSubtitle')).toBeInTheDocument();
    });

    it('does not show the upload button when onUploadSubtitle is not provided', () => {
        renderWithMenu();
        expect(screen.queryByText('uploadSubtitle')).not.toBeInTheDocument();
    });

    // ── checkboxes / multi-select ──────────────────────────────────────────────

    it('renders a checkbox for every subtitle', () => {
        renderWithMenu();
        expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    });

    it('shows no checkboxes checked when selectedSubtitleIndices is empty', () => {
        renderWithMenu({ selectedSubtitleIndices: [] });
        screen.getAllByRole('checkbox').forEach(cb => expect(cb).not.toBeChecked());
    });

    it('checks the correct checkboxes based on selectedSubtitleIndices', () => {
        renderWithMenu({ selectedSubtitleIndices: [0, 2] });
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes[0]).toBeChecked();
        expect(checkboxes[1]).not.toBeChecked();
        expect(checkboxes[2]).toBeChecked();
    });

    it('disables uncheckable subtitles when 2 are already selected', () => {
        renderWithMenu({ selectedSubtitleIndices: [0, 2] });
        // French (index 1) is not selected and the max (2) is reached — it must be disabled
        const frItem = screen.getByText('Spanish').closest('li');
        expect(frItem).toHaveAttribute('aria-disabled', 'true');
    });

    it('does not disable a currently selected subtitle when 2 are selected', () => {
        renderWithMenu({ selectedSubtitleIndices: [0, 2] });
        const enItem = screen.getByText('English').closest('li');
        expect(enItem).not.toHaveAttribute('aria-disabled', 'true');
        const frItem = screen.getByText('French').closest('li');
        expect(frItem).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('enables all items when fewer than 2 are selected', () => {
        renderWithMenu({ selectedSubtitleIndices: [1] });
        const items = ['English', 'Spanish', 'French'].map(label =>
            screen.getByText(label).closest('li')
        );
        items.forEach(item => expect(item).not.toHaveAttribute('aria-disabled', 'true'));
    });

    // ── delete subtitle ────────────────────────────────────────────────────────

    it('shows a delete button for each subtitle when onDeleteSubtitle is provided', () => {
        renderWithMenu({ onDeleteSubtitle: vi.fn() });
        expect(screen.getAllByRole('button', { name: 'delete' })).toHaveLength(3);
    });

    it('does not show delete buttons when onDeleteSubtitle is not provided', () => {
        renderWithMenu();
        expect(screen.queryAllByRole('button', { name: 'delete' })).toHaveLength(0);
    });

    it('opens a confirmation dialog when a delete button is clicked', () => {
        renderWithMenu({ onDeleteSubtitle: vi.fn() });
        fireEvent.click(screen.getAllByRole('button', { name: 'delete' })[0]);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('confirmDeleteSubtitle')).toBeInTheDocument();
    });

    it('calls onDeleteSubtitle with the correct index after confirmation', async () => {
        const onDeleteSubtitle = vi.fn().mockResolvedValue(undefined);
        renderWithMenu({ onDeleteSubtitle });

        // Click delete button for the second subtitle (index 1)
        fireEvent.click(screen.getAllByRole('button', { name: 'delete' })[1]);

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'delete' }));

        await vi.waitFor(() => {
            expect(onDeleteSubtitle).toHaveBeenCalledWith(1);
        });
    });

    it('closes the confirmation dialog when cancel is clicked', async () => {
        renderWithMenu({ onDeleteSubtitle: vi.fn() });
        fireEvent.click(screen.getAllByRole('button', { name: 'delete' })[0]);
        fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
    });

    it('does not call onDeleteSubtitle when cancel is clicked', () => {
        const onDeleteSubtitle = vi.fn();
        renderWithMenu({ onDeleteSubtitle });
        fireEvent.click(screen.getAllByRole('button', { name: 'delete' })[0]);
        fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
        expect(onDeleteSubtitle).not.toHaveBeenCalled();
    });
});
