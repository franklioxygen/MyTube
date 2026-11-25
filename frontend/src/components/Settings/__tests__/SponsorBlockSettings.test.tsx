import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SponsorBlockSettings from '../SponsorBlockSettings';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('SponsorBlockSettings', () => {
    const onChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('is off by default and hides the categories', () => {
        render(<SponsorBlockSettings settings={{} as never} onChange={onChange} />);
        expect(screen.getByRole('switch', { name: 'sponsorBlockEnable' })).not.toBeChecked();
        expect(screen.queryByText('sponsorBlockCategorySponsor')).toBeNull();
    });

    it('turns the feature on', async () => {
        render(<SponsorBlockSettings settings={{} as never} onChange={onChange} />);
        await userEvent.setup().click(screen.getByRole('switch', { name: 'sponsorBlockEnable' }));
        expect(onChange).toHaveBeenCalledWith('sponsorBlockEnabled', true);
    });

    it('shows the default modes: sponsor skipped automatically, the rest off', () => {
        render(<SponsorBlockSettings settings={{ sponsorBlockEnabled: true } as never} onChange={onChange} />);
        expect(screen.getByRole('combobox', { name: /sponsorBlockCategorySponsor/ })).toHaveTextContent('sponsorBlockModeAuto');
        expect(screen.getByRole('combobox', { name: /sponsorBlockCategoryFiller\b/ })).toHaveTextContent('sponsorBlockModeOff');
    });

    it('changes one category and keeps the others', async () => {
        const user = userEvent.setup();
        render(
            <SponsorBlockSettings
                settings={{ sponsorBlockEnabled: true, sponsorBlockCategories: { sponsor: 'auto' } } as never}
                onChange={onChange}
            />
        );
        await user.click(screen.getByRole('combobox', { name: /sponsorBlockCategoryIntro\b/ }));
        await user.click(within(screen.getByRole('listbox')).getByText('sponsorBlockModeManual'));
        expect(onChange).toHaveBeenCalledWith('sponsorBlockCategories', { sponsor: 'auto', intro: 'manual' });
    });
});
