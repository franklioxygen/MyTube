import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import CollapsibleSection from '../CollapsibleSection';

describe('CollapsibleSection deferred content', () => {
    it('initializes on first expansion and retains edits when collapsed again', async () => {
        const user = userEvent.setup();
        const onMount = vi.fn();
        function Draft() {
            useEffect(() => { onMount(); }, []);
            return <input aria-label="Draft" />;
        }
        render(<CollapsibleSection title="Settings" defaultExpanded={false} deferMount><Draft /></CollapsibleSection>);
        expect(onMount).not.toHaveBeenCalled();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Settings' }));
        const draft = screen.getByRole('textbox', { name: 'Draft' });
        await user.type(draft, 'Keep this edit');
        await user.click(screen.getByRole('button', { name: 'Settings' }));
        expect(draft).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Settings' }));
        expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep this edit');
        expect(onMount).toHaveBeenCalledOnce();
    });

    it('renders the initially expanded section immediately', () => {
        render(<CollapsibleSection title="Settings" deferMount><input aria-label="Draft" /></CollapsibleSection>);
        expect(screen.getByRole('textbox', { name: 'Draft' })).toBeVisible();
    });

    it('mounts on controlled expansion and preserves the draft after controlled collapse', async () => {
        const user = userEvent.setup();
        const section = (expanded: boolean) => (
            <CollapsibleSection title="Settings" expanded={expanded} deferMount>
                <input aria-label="Draft" />
            </CollapsibleSection>
        );
        const { rerender } = render(section(false));
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        rerender(section(true));
        const draft = screen.getByRole('textbox', { name: 'Draft' });
        await user.type(draft, 'Keep this edit');
        rerender(section(false));
        expect(draft).toBeInTheDocument();
        rerender(section(true));
        expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
        expect(draft).toHaveValue('Keep this edit');
    });
});
